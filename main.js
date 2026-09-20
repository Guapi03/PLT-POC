import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { setupAR } from './ar.js';
import { setupLibrary, saveDownload } from './model-store.js';
import { setupUploader } from './model-uploader.js';
import { disposeModel } from './model-io.js';
import { normalizeModelSettings } from './model-settings.js';
import { setupModelEditor, populateCategoryOptions } from './model-editor.js';
import { applyMaterialAppearance } from './appearance.js';

const $ = s => document.querySelector(s);
const state = {
 loaded: false,
 busy: false,
 lift: 0,
 selected: null,
 view: 'glass',
 hideBottle: false,
 autoRotate: false,
 inAR: false,
 modelId: null,
 category: 'Non-builded',
 settings: null,
 themeColor: '#7BE6CC'
};

const host = $('#canvas-host');
let renderer;

try {
 renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch (error) {
 const msgEl = $('#load-message');
 if (msgEl) msgEl.textContent = '当前浏览器无法启动 3D，请开启硬件加速或更换浏览器。';
 const spinnerEl = $('.spinner');
 if (spinnerEl) spinnerEl.hidden = true;
 throw error;
}

renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local');
host.append(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(34, 1, 0.001, 20);
camera.position.set(0.42, 0.26, 0.63);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.target.set(0, 0.15, 0);
controls.maxPolarAngle = Math.PI * 0.88;
controls.autoRotateSpeed = 0.7;

const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
const envTarget = pmrem.fromScene(room, 0.04);
scene.environment = envTarget.texture;
scene.environmentIntensity = 0.7;
room.dispose();
pmrem.dispose();

scene.add(new THREE.HemisphereLight(0xe5f5ff, 0x293b41, 1.4));
const key = new THREE.DirectionalLight(0xffffff, 2.6);
key.position.set(-0.5, 0.8, 1);
scene.add(key);
const rim = new THREE.DirectionalLight(0xb8e8ff, 2);
rim.position.set(0.5, 0.5, -0.4);
scene.add(rim);

const product = new THREE.Group();
scene.add(product);
const assembly = new THREE.Group();
product.add(assembly);

const parts = {};
const partInfo = {};
const originals = new Map();
const meshById = new Map();
let active = null;
let library;
let ar;
let editor;
let meshDescriptors = [];

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

const shadowCanvas = document.createElement('canvas');
shadowCanvas.width = shadowCanvas.height = 128;
const ctx = shadowCanvas.getContext('2d');
const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
grad.addColorStop(0, 'rgba(0,0,0,.4)');
grad.addColorStop(0.4, 'rgba(0,0,0,.2)');
grad.addColorStop(1, 'rgba(0,0,0,0)');
ctx.fillStyle = grad;
ctx.fillRect(0, 0, 128, 128);

const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false })
);
shadow.rotation.x = -Math.PI / 2;
shadow.position.y = -0.0005;
scene.add(shadow);

function resize() {
 if (state.inAR) return;
 const r = host.getBoundingClientRect();
 if (!r.width || !r.height) return;
 renderer.setSize(r.width, r.height);
 camera.aspect = r.width / r.height;
 camera.updateProjectionMatrix();
 if (state.loaded) fitView();
}
new ResizeObserver(resize).observe(host);
resize();

function fitView(resetAngle = false) {
 if (!state.loaded || state.inAR) return;
 const box = new THREE.Box3().setFromObject(product);
 const center = box.getCenter(new THREE.Vector3());
 const size = box.getSize(new THREE.Vector3());
 const radius = Math.max(size.length() / 2, 0.0001);
 const vfov = THREE.MathUtils.degToRad(camera.fov);
 const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
 const d = (radius / Math.sin(Math.min(vfov, hfov) / 2)) * (window.matchMedia('(max-width:620px)').matches ? 1.25 : 1.1);
 const direction = resetAngle ? new THREE.Vector3(0.38, 0.14, 1).normalize() : camera.position.clone().sub(controls.target).normalize();
 controls.minDistance = radius * 0.25;
 controls.maxDistance = d * 8;
 camera.near = Math.max(radius / 1000, 0.000001);
 camera.far = Math.max(d * 20, 10);
 camera.updateProjectionMatrix();
 controls.target.copy(center);
 camera.position.copy(center).addScaledVector(direction, d);
 controls.update();
}

// 核心修复：彻底隔离 view 模式与 selected 高亮状态
function applyAppearance(arMode = false) {
 for (const [obj, saved] of originals) {
  const bases = [].concat(saved.material);
  const group = state.settings?.groups.find(g => g.id === saved.part);
  const isSelected = state.selected === saved.part;

  [].concat(obj.material).forEach((m, i) => {
   // 1. 还原基础外貌（处理不透明度、预设材质形态等）
   applyMaterialAppearance(m, bases[i], {
    preset: group?.preset || 'auto',
    glassOpacity: state.settings?.glassOpacity ?? 0.18,
    view: state.view,
    arMode,
    selected: isSelected
   });

   // 2. 状态隔离管理
   if (state.view === 'original') {
    // 原始视图：强行还原 GLB 原始色彩，彻底清除高亮发光
    if (m.emissive) {
     m.emissive.setHex(0x000000);
     m.emissiveIntensity = 0;
    }
   } else {
    // 玻璃 / 结构视图：统一施加全局主题色
    if (state.themeColor && m.color) {
     m.color.set(state.themeColor);
    }

    // 处理选中高亮：使用自发光 (Emissive) 进行层次区分，未选中则清空发光
    if (m.emissive) {
     if (isSelected) {
      m.emissive.set(state.themeColor || 0x7be6cc);
      m.emissiveIntensity = 0.45;
     } else {
      m.emissive.setHex(0x000000);
      m.emissiveIntensity = 0;
     }
    }
   }
  });
 }
}

function selectPart(part) {
 if (part !== null && !Object.hasOwn(parts, part)) throw new Error('找不到这个部件。');
 state.selected = part;
 document.querySelectorAll('[data-part]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.part === part)));

 const titleEl = $('#detail-title');
 if (titleEl) titleEl.textContent = part ? partInfo[part].name : '选择部件，查看模型。';

 const copyEl = $('#detail-copy');
 if (copyEl) copyEl.textContent = part ? (partInfo[part].description || `包含 ${parts[part].length} 个网格。`) : '点击模型或上方列表，定位一个部件。';

 applyAppearance(state.inAR);
 return getState();
}

function updatePaletteUI() {
 const circle = $('#color-circle');
 const hexText = $('#color-hex-text');
 const input = $('#custom-color-input');
 const currentHex = state.themeColor || '#7BE6CC';

 if (circle) circle.style.backgroundColor = currentHex;
 if (hexText) hexText.textContent = currentHex.toUpperCase();
 if (input) input.value = currentHex;

 document.querySelectorAll('.color-dot').forEach(dot => {
  const dotColor = dot.dataset.color;
  dot.classList.toggle('active', !!(dotColor && dotColor.toLowerCase() === currentHex.toLowerCase()));
 });
}

function setThemeColor(hex) {
 state.themeColor = hex;
 updatePaletteUI();
 applyAppearance(state.inAR);
}

document.querySelectorAll('.color-dot').forEach(dot => {
 dot.addEventListener('click', () => setThemeColor(dot.dataset.color));
});
$('#custom-color-input')?.addEventListener('input', e => setThemeColor(e.target.value));

function setLift(value, { fit = true } = {}) {
 const mm = Number(value);
 const config = state.settings?.assembly;
 if (!Number.isFinite(mm) || mm < 0 || mm > (config?.distanceMm ?? 180)) throw new Error('位移超出了此模型设置的距离。');
 if (!config?.enabled && mm !== 0) throw new Error('此模型尚未启用观察装配。');

 state.lift = mm;
 assembly.position.set(0, 0, 0);
 if (config?.enabled) assembly.position[config.axis] = (mm / 1000) * config.direction;

 const liftEl = $('#lift');
 if (liftEl) liftEl.value = String(mm);
 const liftValEl = $('#lift-value');
 if (liftValEl) liftValEl.textContent = Number(mm.toFixed(1)) + ' mm';
 const toggleEl = $('#assembly-toggle');
 if (toggleEl) toggleEl.textContent = mm > 0 ? '复原组装 ↓' : '展开部件 ↑';

 product.updateMatrixWorld(true);
 if (fit) fitView();
 ar?.invalidate();
 return getState();
}

function setHidden(hidden) {
 const config = state.settings?.assembly;
 if (hidden && (!config?.enabled || !config.hiddenGroupIds.length)) throw new Error('尚未配置可隐藏的部件。');
 state.hideBottle = !!hidden;
 for (const [id, meshes] of Object.entries(parts)) {
  for (const obj of meshes) obj.visible = !(hidden && config.hiddenGroupIds.includes(id));
 }
 const hideBottleEl = $('#hide-bottle');
 if (hideBottleEl) hideBottleEl.checked = !!hidden;
 ar?.invalidate();
 return getState();
}

function setView(view) {
 if (!['glass', 'original', 'solid'].includes(view)) throw new Error('显示方式无效。');
 state.view = view;
 document.querySelectorAll('[data-view]').forEach(b => {
  b.classList.toggle('active', b.dataset.view === view);
  b.setAttribute('aria-pressed', String(b.dataset.view === view));
 });
 applyAppearance(state.inAR);
 return getState();
}

function getState() {
 return {
  ...state,
  settings: state.settings ? structuredClone(state.settings) : null,
  modelName: active?.name,
  parts: Object.entries(parts).map(([id, meshes]) => ({
   id,
   name: partInfo[id].name,
   meshCount: meshes.length,
   meshIds: partInfo[id].meshIds
  })),
  materials: [...originals.keys()].map(obj => ({
   meshId: obj.userData.meshId,
   part: obj.userData.part,
   opacity: [].concat(obj.material).map(m => m.opacity),
   transmission: [].concat(obj.material).map(m => m.transmission || 0)
  }))
 };
}

function reset() {
 setLift(0);
 setHidden(false);
 selectPart(null);
 setView('glass');
 state.autoRotate = false;
 controls.autoRotate = false;
 const autoRotEl = $('#auto-rotate');
 if (autoRotEl) autoRotEl.checked = false;
 fitView(true);
 return getState();
}

function drawParts() {
 const partListEl = $('#part-list');
 if (!partListEl) return;
 partListEl.replaceChildren();

 Object.keys(parts).forEach((id, i) => {
  const b = document.createElement('button');
  b.className = 'part-button';
  b.dataset.part = id;
  b.setAttribute('aria-pressed', 'false');
  const number = document.createElement('span');
  number.className = 'part-number';
  number.textContent = String(i + 1).padStart(2, '0');
  const label = document.createElement('span');
  label.textContent = partInfo[id].name;
  b.append(number, label);
  b.onclick = () => selectPart(state.selected === id ? null : id);
  partListEl.append(b);
 });

 const countEl = $('#part-count');
 if (countEl) countEl.textContent = Object.keys(parts).length + ' 个部件';
}

function applySettings(raw) {
 state.settings = normalizeModelSettings(raw, meshDescriptors, { category: state.category });
 assembly.position.set(0, 0, 0);
 for (const obj of meshById.values()) {
  product.add(obj);
  obj.visible = true;
 }
 for (const id of Object.keys(parts)) delete parts[id];
 for (const id of Object.keys(partInfo)) delete partInfo[id];

 for (const group of state.settings.groups) {
  parts[group.id] = group.meshIds.map(id => meshById.get(id)).filter(Boolean);
  partInfo[group.id] = group;
  for (const obj of parts[group.id]) {
   obj.userData.part = group.id;
   originals.get(obj).part = group.id;
  }
 }

 const config = state.settings.assembly;
 if (config.enabled) {
  for (const id of config.movingGroupIds) {
   for (const obj of parts[id] || []) assembly.add(obj);
  }
 }

 const assemblySecEl = $('#assembly-section');
 if (assemblySecEl) assemblySecEl.hidden = !config.enabled;
 const liftEl = $('#lift');
 if (liftEl) liftEl.max = String(config.distanceMm);
 const liftMaxEl = $('#lift-max');
 if (liftMaxEl) liftMaxEl.textContent = config.distanceMm + ' mm';

 const hidePartsRow = $('#hide-parts-row');
 if (hidePartsRow) hidePartsRow.hidden = !config.hiddenGroupIds.length;
 const hidePartsLabel = $('#hide-parts-label');
 if (hidePartsLabel) {
  hidePartsLabel.textContent = '隐藏：' + config.hiddenGroupIds.map(id => partInfo[id]?.name).filter(Boolean).join('、');
 }

 drawParts();
 setLift(0, { fit: false });
 setHidden(false);
 selectPart(null);
 fitView();
 ar?.invalidate();
}

async function activate(entry, gltf) {
 if (state.inAR) throw new Error('请先退出 AR。');
 state.loaded = false;
 ar?.invalidate();

 for (const [obj, saved] of originals) {
  [].concat(obj.material).forEach(m => m.dispose());
  obj.material = saved.material;
 }

 disposeModel(product);
 originals.clear();
 meshById.clear();
 product.clear();
 assembly.clear();
 assembly.position.set(0, 0, 0);
 product.add(assembly);
 product.position.set(0, 0, 0);
 product.quaternion.identity();
 product.scale.set(1, 1, 1);

 active = entry;
 state.modelId = entry.id;
 state.category = entry.category || 'Non-builded';
 state.selected = null;
 state.lift = 0;
 state.hideBottle = false;

 const model = gltf.scene;
 product.add(model);
 product.updateMatrixWorld(true);

 const box = new THREE.Box3().setFromObject(product);
 const center = box.getCenter(new THREE.Vector3());
 model.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
 product.updateMatrixWorld(true);

 const loaded = [];
 model.traverse(obj => {
  if (obj.isMesh) loaded.push({ obj, matrix: obj.matrixWorld.clone() });
 });
 meshDescriptors = [];

 loaded.forEach(({ obj, matrix }, index) => {
  const id = 'mesh-' + index;
  meshDescriptors.push({ id, name: obj.name || '部件 ' + (index + 1) });
  meshById.set(id, obj);
  obj.userData.meshId = id;
  const base = obj.material;
  const cloned = [].concat(base).map(m => m.clone());
  obj.material = cloned.length === 1 ? cloned[0] : cloned;
  originals.set(obj, { material: base, part: null });
  product.add(obj);
  obj.matrixAutoUpdate = false;
  obj.matrix.copy(matrix);
  obj.matrixWorldNeedsUpdate = true;
 });
 product.remove(model);

 const size = new THREE.Box3().setFromObject(product).getSize(new THREE.Vector3());
 shadow.scale.setScalar(Math.max(size.x, size.z) * 2.2);
 shadow.position.y = -Math.max(size.y * 0.001, 0.00001);

 const titleEl = $('#model-title');
 if (titleEl) titleEl.textContent = entry.name;
 const subTitleEl = $('#model-subtitle');
 if (subTitleEl) subTitleEl.textContent = entry.description || '独立配件模型';
 const noteEl = $('#model-note');
 if (noteEl) noteEl.textContent = state.category === 'Bottles' ? '照片估算尺寸 · 容积未校准' : '按 GLB 导出尺寸展示';
 const scaleEl = $('#scale-note');
 if (scaleEl) scaleEl.textContent = `MODEL HEIGHT ≈ ${(size.y * 1000).toLocaleString('en', { maximumFractionDigits: 1 })} mm`;

 state.loaded = true;
 applySettings(entry.settings);
 reset();

 const loadingEl = $('#loading');
 if (loadingEl) loadingEl.hidden = true;
}

$('#lift')?.addEventListener('input', e => setLift(e.target.value));
$('#assembly-toggle')?.addEventListener('click', () => setLift(state.lift > 0 ? 0 : state.settings?.assembly?.distanceMm || 0));
$('#hide-bottle')?.addEventListener('change', e => setHidden(e.target.checked));
$('#auto-rotate')?.addEventListener('change', e => {
 state.autoRotate = e.target.checked;
 controls.autoRotate = state.autoRotate;
});
$('#reset-camera')?.addEventListener('click', () => fitView(true));
$('#retry')?.addEventListener('click', () => location.reload());

document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

$('#download-model')?.addEventListener('click', async e => {
 e.preventDefault();
 if (!active || !library) return;
 try {
  saveDownload(new Blob([await library.getBytes(active)], { type: 'model/gltf-binary' }), active.name.replace(/[\\/:*?"<>|]/g, '-') + '.glb');
 } catch (error) {
  const noteEl = $('#model-note');
  if (noteEl) noteEl.textContent = error.message;
 }
});

let down;
renderer.domElement.addEventListener('pointerdown', e => {
 down = { x: e.clientX, y: e.clientY };
});
renderer.domElement.addEventListener('pointerup', e => {
 if (!state.loaded || state.inAR || state.busy || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
 const r = renderer.domElement.getBoundingClientRect();
 pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
 raycaster.setFromCamera(pointer, camera);
 const hits = raycaster.intersectObjects(Object.values(parts).flat().filter(o => o.visible), false);
 selectPart(hits[0]?.object.userData.part || null);
});

ar = setupAR({ THREE, renderer, scene, camera, controls, product, shadow, state, originals, applyAppearance, fitView, resize, getState });

editor = setupModelEditor({
 getContext: () => ({ entry: active, meshes: meshDescriptors, settings: state.settings }),
 isBusy: () => !state.loaded || state.busy || state.inAR || state.arStarting,
 onPreview: settings => {
  applySettings(settings);
  setView('glass');
 },
 onSave: async patch => {
  const settings = normalizeModelSettings(patch.settings, meshDescriptors, { category: state.category });

  if (patch.newGlbFile) {
   const buffer = await patch.newGlbFile.arrayBuffer();
   await library.saveBytes(active.id, buffer);
  }

  active = await library.updateEntry(active.id, {
   name: patch.name,
   description: patch.description,
   category: patch.category,
   settings
  });

  const titleEl = $('#model-title');
  if (titleEl) titleEl.textContent = active.name;
  const subTitleEl = $('#model-subtitle');
  if (subTitleEl) subTitleEl.textContent = active.description || '独立配件模型';

  if (patch.newGlbFile) {
   await library.choose(active.id);
  } else {
   applySettings(active.settings);
   setView('glass');
  }

  const noteEl = $('#model-note');
  if (noteEl) noteEl.textContent = '设置已保存在此浏览器 · 导出网站包可发布';
 }
});

$('#edit-model')?.addEventListener('click', () => editor?.open());

let lastTime = 0;
renderer.setAnimationLoop((time, frame) => {
 const dt = Math.min((time - lastTime) / 1000, 0.05);
 lastTime = time;
 if (state.inAR) ar.onFrame(frame);
 else controls.update(dt);
 renderer.render(scene, camera);
});

async function init() {
 try {
  const importCategorySelect = $('#import-category');
  if (importCategorySelect) {
   populateCategoryOptions(importCategorySelect, 'Non-builded');
  }

  library = await setupLibrary({
   activate,
   getActive: () => active,
   isBusy: () => state.inAR || state.arStarting,
   onBusyChange: busy => {
    state.busy = busy;
    const openArBtn = $('#open-ar');
    if (openArBtn) openArBtn.disabled = busy || !state.loaded;
    const editBtn = $('#edit-model');
    if (editBtn) editBtn.disabled = busy || !state.loaded;
   }
  });

  setupUploader({
   getCachedModels: () => library.list(),
   onUploadSuccess: async (targetId) => {
    await library.refresh();
    if (targetId) await library.choose(targetId);
   }
  });

  const openArBtn = $('#open-ar');
  if (openArBtn) openArBtn.disabled = false;
  const editBtn = $('#edit-model');
  if (editBtn) editBtn.disabled = false;

  registerTools();
 } catch (error) {
  console.error(error);
  const msgEl = $('#load-message');
  if (msgEl) msgEl.textContent = '模型库未能载入：' + error.message;
  const spinnerEl = $('#loading .spinner');
  if (spinnerEl) spinnerEl.hidden = true;
  const retryBtn = $('#retry');
  if (retryBtn) retryBtn.hidden = false;
  const fbEl = $('#library-feedback');
  if (fbEl) fbEl.textContent = error.message;
 }
}

function registerTools() {
 const context = document.modelContext;
 if (!context?.registerTool) return;
 const controller = new AbortController();
 window.addEventListener('pagehide', e => {
  if (!e.persisted) controller.abort();
 });

 const tools = [
  { name: 'read_glass_model_state', description: 'Read selected model, editable groups, appearance and assembly settings.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: getState },
  { name: 'list_model_library', description: 'List available models in this browser and website.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: () => library.list() },
  { name: 'select_library_model', description: 'Select one existing model for preview.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false }, annotations: { readOnlyHint: false }, execute: async ({ id }) => { if (editor?.isOpen()) throw new Error('请先保存或取消编辑。'); await library.choose(id); return getState(); } },
  { name: 'configure_glass_model', description: 'Change preview controls. Assembly controls require the model to have assembly enabled in its editor.', inputSchema: { type: 'object', properties: { lift_mm: { type: 'number', minimum: 0, maximum: 1000 }, hide_bottle: { type: 'boolean' }, part: { type: ['string', 'null'] }, view: { type: 'string', enum: ['glass', 'original', 'solid'] } }, additionalProperties: false }, annotations: { readOnlyHint: false }, execute(input) {
    if (state.busy || state.inAR || editor?.isOpen()) throw new Error('模型正忙，请稍后操作。');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected object');
    for (const k of Object.keys(input)) if (!['lift_mm', 'hide_bottle', 'part', 'view'].includes(k)) throw new Error('Unknown setting');
    if ('lift_mm' in input && (typeof input.lift_mm !== 'number' || !Number.isFinite(input.lift_mm) || input.lift_mm < 0 || input.lift_mm > state.settings.assembly.distanceMm || !state.settings.assembly.enabled)) throw new Error('Invalid lift');
    if ('hide_bottle' in input && (typeof input.hide_bottle !== 'boolean' || !state.settings.assembly.enabled || !state.settings.assembly.hiddenGroupIds.length)) throw new Error('Invalid hide_bottle');
    if ('part' in input && input.part !== null && !Object.hasOwn(parts, input.part)) throw new Error('Invalid part');
    if ('view' in input && !['glass', 'original', 'solid'].includes(input.view)) throw new Error('Invalid view');
    if ('lift_mm' in input) setLift(input.lift_mm);
    if ('hide_bottle' in input) setHidden(input.hide_bottle);
    if ('part' in input) selectPart(input.part);
    if ('view' in input) setView(input.view);
    return getState();
   } },
  { name: 'reset_glass_model', description: 'Reset current model controls and camera.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false }, execute: () => { if (state.busy || state.inAR || editor?.isOpen()) throw new Error('模型正忙。'); return reset(); } }
 ];

 for (const tool of tools) {
  try {
   Promise.resolve(context.registerTool(tool, { signal: controller.signal })).catch(console.warn);
  } catch (error) {
   console.warn(error);
  }
 }
}

init();