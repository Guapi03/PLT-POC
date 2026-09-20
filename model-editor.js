import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { normalizeModelSettings, mergeGroups, splitGroup } from './model-settings.js';

const PRESETS = [
  ['auto', '自动识别'],
  ['original', '原始材质'],
  ['glass', '透明玻璃'],
  ['frosted', '磨砂玻璃'],
  ['solid', '不透明材质'],
  ['custom', '🎨 自定义颜色'],
];

let categoryOptions = [
  ['Adapters', 'Adapters'],
  ['Bottles', 'Bottles'],
  ['Non-builded', 'Non-builded']
];

const copy = value => JSON.parse(JSON.stringify(value));

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text, className, action) {
  const node = el('button', className, text);
  node.type = 'button';
  if (action) node.addEventListener('click', action);
  return node;
}
function labeled(title, input, className = 'editor-field') {
  const label = el('label', className);
  label.append(el('span', 'editor-field-title', title), input);
  return label;
}
function optionSelect(options, value) {
  const select = el('select');
  for (const [key, label] of options) {
    const option = el('option', '', label);
    option.value = key;
    select.append(option);
  }
  select.value = value;
  return select;
}

export async function populateCategoryOptions(selectElement, selectedValue = 'Non-builded', supabaseClient = window.supabase) {
  if (!selectElement) return;

  try {
    if (supabaseClient && typeof supabaseClient.rpc === 'function') {
      const { data: categories, error } = await supabaseClient.rpc('get_model_category_enum');
      if (!error && Array.isArray(categories) && categories.length > 0) {
        categoryOptions = categories.map(cat => [cat, cat]);
      }
    }
  } catch (err) {
    console.warn('获取 Supabase 枚举失败，使用默认分类选项:', err);
  }

  selectElement.innerHTML = '';
  for (const [key, label] of categoryOptions) {
    const option = el('option', '', label);
    option.value = key;
    if (key === selectedValue) option.selected = true;
    selectElement.append(option);
  }
}

export function setupModelEditor({ getContext, onSave, isBusy = () => false }) {
  const cssURL = new URL('./model-editor.css', import.meta.url).href;
  if (![...document.querySelectorAll('link[rel="stylesheet"]')].some(link => link.href === cssURL)) {
    const link = el('link');
    link.rel = 'stylesheet';
    link.href = cssURL;
    document.head.append(link);
  }

  const dialog = el('dialog', 'model-editor');
  dialog.id = 'model-editor-dialog';
  dialog.setAttribute('aria-labelledby', 'model-editor-title');
  const form = el('form', 'model-editor-form');
  form.noValidate = true;

  const header = el('header', 'editor-header');
  const heading = el('div');
  heading.append(el('p', 'eyebrow', 'MODEL SETTINGS'));
  const title = el('h2', '', '编辑模型');
  title.id = 'model-editor-title';
  heading.append(title, el('p', 'editor-intro', '设置展示材质、探索分组与装配动作。保存后同步更新。'));
  const close = button('×', 'editor-close', () => cancel());
  close.id = 'model-editor-close';
  close.setAttribute('aria-label', '取消并关闭编辑');
  header.append(heading, close);

  const mainLayout = el('div', 'editor-main-layout');

  const fields = el('fieldset', 'editor-fields');
  const body = el('div', 'editor-body');
  fields.append(body);

  // 3D 实时结构预览面板
  const previewPanel = el('div', 'editor-preview-panel');
  const previewHeader = el('div', 'editor-preview-header');
  previewHeader.append(el('span', 'editor-preview-title', '实时结构预览 (Solid Mode)'));
  previewHeader.append(el('span', 'editor-preview-badge', '3D 视图'));

  const previewCanvasHost = el('div', 'editor-preview-canvas-host');
  previewCanvasHost.id = 'editor-preview-canvas-host';
  previewPanel.append(previewHeader, previewCanvasHost);

  mainLayout.append(fields, previewPanel);

  const footer = el('footer', 'editor-footer');
  const feedback = el('p', 'editor-feedback');
  feedback.id = 'model-editor-feedback';
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');
  const actions = el('div', 'editor-actions');
  const cancelButton = button('取消', 'editor-button', () => cancel());
  cancelButton.id = 'model-editor-cancel';

  const saveButton = button('保存设置', 'editor-button editor-primary');
  saveButton.id = 'model-editor-save';
  saveButton.type = 'submit';
  actions.append(cancelButton, saveButton);
  footer.append(feedback, actions);

  form.append(header, mainLayout, footer);
  dialog.append(form);
  document.body.append(dialog);

  let context, draft, originalSettings, working = false;
  let selectedGroups = new Set();
  let groupList, assemblyList, mergeButton, assemblyFields, nameInput;
  let moveLabels = new Map();
  let hideLabels = new Map();

  // 3D 预览视口相关变量
  let pRenderer, pScene, pCamera, pControls, pMeshMap = new Map(), hoveredGroupId = null, animId = null;

  function initPreview() {
    if (!previewCanvasHost) return;

    if (!pRenderer) {
      pScene = new THREE.Scene();
      pScene.background = new THREE.Color('#0e1c23');

      const ambient = new THREE.AmbientLight(0xffffff, 0.9);
      const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
      dirLight1.position.set(5, 10, 7);
      const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
      dirLight2.position.set(-5, -5, -5);
      pScene.add(ambient, dirLight1, dirLight2);

      pCamera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);

      pRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      pRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      previewCanvasHost.replaceChildren(pRenderer.domElement);

      pControls = new OrbitControls(pCamera, pRenderer.domElement);
      pControls.enableDamping = true;
      pControls.dampingFactor = 0.05;

      const resizeObserver = new ResizeObserver(() => updatePreviewAspect());
      resizeObserver.observe(previewCanvasHost);

      function animate() {
        animId = requestAnimationFrame(animate);
        if (pControls) pControls.update();
        if (pRenderer && pScene && pCamera) pRenderer.render(pScene, pCamera);
      }
      animate();
    }
  }

  function updatePreviewAspect() {
    if (!previewCanvasHost || !pRenderer || !pCamera) return;
    const width = previewCanvasHost.clientWidth || 300;
    const height = previewCanvasHost.clientHeight || 250;
    pCamera.aspect = width / height;
    pCamera.updateProjectionMatrix();
    pRenderer.setSize(width, height, false);
  }

  function updatePreviewScene() {
    if (!pScene || !context || !context.meshes) return;

    pMeshMap.forEach(mesh => pScene.remove(mesh));
    pMeshMap.clear();

    const groupPalette = [
      '#4ea8de', '#560bad', '#f72585', '#4895ef', '#3a0ca3',
      '#b5179e', '#7209b7', '#4361ee', '#4cc9f0'
    ];

    const box = new THREE.Box3();

    const meshToGroup = new Map();
    draft.settings.groups.forEach((g, idx) => {
      g.meshIds.forEach(id => meshToGroup.set(String(id), { group: g, index: idx }));
    });

    context.meshes.forEach(item => {
      const targetMesh = item.isMesh ? item : (item.mesh || item.node || item);
      const meshId = String(item.id || targetMesh.id || targetMesh.name || targetMesh.uuid);

      if (!targetMesh || !targetMesh.geometry) return;

      const groupInfo = meshToGroup.get(meshId) || meshToGroup.get(String(targetMesh.name)) || meshToGroup.get(String(targetMesh.id));
      const isHovered = groupInfo && hoveredGroupId === groupInfo.group.id;

      let colorHex = groupPalette[(groupInfo ? groupInfo.index : 0) % groupPalette.length];

      if (groupInfo && groupInfo.group.preset === 'custom' && groupInfo.group.customColor) {
        colorHex = groupInfo.group.customColor;
      }

      const mat = new THREE.MeshPhongMaterial({
        color: isHovered ? '#7be6cc' : colorHex,
        emissive: isHovered ? '#1a5c4e' : '#000000',
        shininess: isHovered ? 90 : 30,
        side: THREE.DoubleSide
      });

      const previewMesh = new THREE.Mesh(targetMesh.geometry, mat);

      targetMesh.updateMatrixWorld(true);
      previewMesh.matrix.copy(targetMesh.matrixWorld || targetMesh.matrix);
      previewMesh.matrix.decompose(previewMesh.position, previewMesh.quaternion, previewMesh.scale);

      pScene.add(previewMesh);
      pMeshMap.set(meshId, previewMesh);

      box.expandByObject(previewMesh);
    });

    if (!box.isEmpty()) {
      const center = new THREE.Vector3();
      box.getCenter(center);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z, 0.1);

      pControls.target.copy(center);
      const fov = pCamera.fov * (Math.PI / 180);
      let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 2.0;
      pCamera.position.set(center.x + cameraZ * 0.5, center.y + cameraZ * 0.4, center.z + cameraZ);
      pCamera.lookAt(center);
      pControls.update();
    }
  }

  function status(message, error = false) {
    feedback.textContent = message;
    feedback.classList.toggle('error', error);
  }
  function busy(value) {
    working = value;
    fields.disabled = value;
    for (const node of [close, cancelButton, saveButton]) node.disabled = value;
    dialog.setAttribute('aria-busy', String(value));
    saveButton.textContent = value ? '请稍候…' : '保存设置';
  }

  function normalized() {
    const norm = normalizeModelSettings(copy(draft.settings), context.meshes, { category: draft.category });
    norm.groups.forEach((g, idx) => {
      const draftGroup = draft.settings.groups[idx];
      if (draftGroup) {
        if (draftGroup.preset === 'custom') g.preset = 'custom';
        if (draftGroup.customColor) g.customColor = draftGroup.customColor;
      }
    });
    return norm;
  }

  function validate() {
    if (!draft.name.trim()) {
      nameInput.focus();
      throw new Error('请填写模型名称。');
    }
    const emptyGroup = draft.settings.groups.find(group => !group.name.trim());
    if (emptyGroup) {
      groupList.querySelectorAll('[data-group-name]').forEach(input => {
        if (input.dataset.groupName === emptyGroup.id) input.focus();
      });
      throw new Error('请为每个探索分组填写名称。');
    }
    if (draft.settings.assembly.enabled && !draft.settings.assembly.movingGroupIds.length) {
      assemblyList.querySelector('input')?.focus();
      throw new Error('启用“观察装配”时，请至少选择一个要移动的分组。');
    }
    const distance = draft.settings.assembly.distanceMm;
    if (draft.settings.assembly.enabled && (!Number.isFinite(distance) || distance < 1 || distance > 1000)) {
      body.querySelector('#editor-assembly-distance')?.focus();
      throw new Error('装配最大移动距离须介于 1 至 1000 mm。');
    }
  }

  function updateMergeButton() {
    mergeButton.textContent = selectedGroups.size ? `合并所选（${selectedGroups.size}）` : '合并所选';
    mergeButton.disabled = selectedGroups.size < 2;
  }
  function updateAssemblyNames(group) {
    const name = group.name.trim() || '未命名分组';
    if (moveLabels.has(group.id)) moveLabels.get(group.id).textContent = name;
    if (hideLabels.has(group.id)) hideLabels.get(group.id).textContent = name;
  }
  function changeGroups(change) {
    const { enabled, axis, direction, distanceMm } = draft.settings.assembly;
    const glassOpacity = draft.settings.glassOpacity;
    draft.settings = change(draft.settings);
    Object.assign(draft.settings.assembly, { enabled, axis, direction, distanceMm });
    draft.settings.glassOpacity = glassOpacity;
  }

  function renderGroups() {
    const meshNames = new Map(context.meshes.map(mesh => [mesh.id, mesh.name]));
    groupList.replaceChildren();
    draft.settings.groups.forEach((group, index) => {
      const card = el('section', 'editor-group');
      card.dataset.groupId = group.id;

      card.addEventListener('mouseenter', () => {
        hoveredGroupId = group.id;
        updatePreviewScene();
      });
      card.addEventListener('mouseleave', () => {
        hoveredGroupId = null;
        updatePreviewScene();
      });

      const top = el('div', 'editor-group-heading');
      const select = el('input');
      select.type = 'checkbox';
      select.checked = selectedGroups.has(group.id);
      select.dataset.selectGroup = group.id;
      select.addEventListener('change', () => {
        if (select.checked) selectedGroups.add(group.id);
        else selectedGroups.delete(group.id);
        updateMergeButton();
      });
      const choice = el('label', 'editor-check');
      choice.append(select, el('span', '', `选择分组 ${String(index + 1).padStart(2, '0')}`));
      top.append(choice, el('span', 'editor-count', `${group.meshIds.length} 个网格`));
      card.append(top);

      const row = el('div', 'editor-group-row');
      const name = el('input');
      name.type = 'text';
      name.maxLength = 80;
      name.value = group.name;
      name.dataset.groupName = group.id;
      name.addEventListener('input', () => { group.name = name.value; updateAssemblyNames(group); });

      const presetWrapper = el('div', 'editor-preset-wrapper');
      const presetSelect = optionSelect(PRESETS, group.preset || 'auto');
      presetSelect.dataset.groupPreset = group.id;

      // 🎨 自定义颜色控制组件
      const colorPickerContainer = el('div', 'color-picker-container');
      colorPickerContainer.style.display = group.preset === 'custom' ? 'flex' : 'none';

      const colorInput = el('input', 'editor-color-input');
      colorInput.type = 'color';
      colorInput.value = group.customColor || '#7be6cc';

      const colorValText = el('span', 'color-val-text', group.customColor || '#7be6cc');

      colorInput.addEventListener('input', (e) => {
        group.customColor = e.target.value;
        colorValText.textContent = e.target.value;
        updatePreviewScene();
      });

      colorPickerContainer.append(colorInput, colorValText);

      presetSelect.addEventListener('change', () => {
        group.preset = presetSelect.value;
        if (group.preset === 'custom') {
          if (!group.customColor) group.customColor = '#7be6cc';
          colorPickerContainer.style.display = 'flex';
        } else {
          colorPickerContainer.style.display = 'none';
        }
        updatePreviewScene();
      });

      presetWrapper.append(presetSelect, colorPickerContainer);

      row.append(labeled('部件名称', name), labeled('展示材质', presetWrapper));
      card.append(row);

      const description = el('input');
      description.type = 'text';
      description.maxLength = 300;
      description.placeholder = '例如：连接瓶身与两根导管';
      description.value = group.description || '';
      description.dataset.groupDescription = group.id;
      description.addEventListener('input', () => { group.description = description.value; });
      card.append(labeled('部件说明（可选）', description));

      const lower = el('div', 'editor-group-bottom');
      const details = el('details', 'editor-members');
      details.append(el('summary', '', '包含的原始网格'));
      const members = el('ul');
      for (const id of group.meshIds) members.append(el('li', '', meshNames.get(id) || id));
      details.append(members);
      lower.append(details);

      if (group.meshIds.length > 1) {
        const split = button('拆分分组', 'editor-text-button', () => {
          changeGroups(settings => splitGroup(settings, group.id, context.meshes));
          selectedGroups.delete(group.id);
          renderGroups();
          renderAssembly();
          updatePreviewScene();
          status('已拆成独立网格分组。保存后生效。');
        });
        split.dataset.splitGroup = group.id;
        lower.append(split);
      }
      card.append(lower);
      groupList.append(card);
    });
    updateMergeButton();
  }

  function renderAssembly() {
    assemblyList.replaceChildren();
    moveLabels = new Map();
    hideLabels = new Map();
    const makeChoices = (titleText, property, targetMap) => {
      const section = el('fieldset', 'editor-choice-section');
      section.append(el('legend', '', titleText));
      for (const group of draft.settings.groups) {
        const input = el('input');
        input.type = 'checkbox';
        input.checked = draft.settings.assembly[property].includes(group.id);
        input.dataset.assemblyGroup = group.id;
        input.dataset.assemblyRole = property;
        input.addEventListener('change', () => {
          const selection = new Set(draft.settings.assembly[property]);
          if (input.checked) selection.add(group.id);
          else selection.delete(group.id);
          draft.settings.assembly[property] = [...selection];
        });
        const name = el('span', '', group.name.trim() || '未命名分组');
        const label = el('label', 'editor-check');
        label.append(input, name);
        targetMap.set(group.id, name);
        section.append(label);
      }
      return section;
    };
    assemblyList.append(
        makeChoices('一起移动的分组', 'movingGroupIds', moveLabels),
        makeChoices('可用开关隐藏的分组（可选）', 'hiddenGroupIds', hideLabels),
    );
  }

  function render() {
    body.replaceChildren();
    const identity = el('section', 'editor-section editor-identity');
    identity.append(el('h3', '', '模型信息'));
    nameInput = el('input');
    nameInput.id = 'editor-model-name';
    nameInput.type = 'text';
    nameInput.maxLength = 80;
    nameInput.value = draft.name;
    nameInput.addEventListener('input', () => { draft.name = nameInput.value; });

    const description = el('textarea');
    description.id = 'editor-model-description';
    description.rows = 2;
    description.maxLength = 300;
    description.value = draft.description;
    description.placeholder = '显示在模型标题下方';
    description.addEventListener('input', () => { draft.description = description.value; });

    const categorySelect = optionSelect(categoryOptions, draft.category || 'Non-builded');
    categorySelect.id = 'editor-model-category';
    populateCategoryOptions(categorySelect, draft.category || 'Non-builded');
    categorySelect.addEventListener('change', () => { draft.category = categorySelect.value; });

    identity.append(
        labeled('模型名称', nameInput),
        labeled('模型说明（可选）', description),
        labeled('模型类型 / 分类', categorySelect)
    );
    body.append(identity);

    const groups = el('section', 'editor-section');
    const groupHeading = el('div', 'editor-section-heading');
    groupHeading.append(el('h3', '', '探索分组'));
    mergeButton = button('合并所选', 'editor-button', () => {
      if (selectedGroups.size < 2) return;
      changeGroups(settings => mergeGroups(settings, [...selectedGroups]));
      selectedGroups.clear();
      renderGroups();
      renderAssembly();
      updatePreviewScene();
      status('已合并为一个探索分组，点击时会一起高亮。');
    });
    mergeButton.id = 'editor-merge-groups';
    groupHeading.append(mergeButton);
    groups.append(groupHeading, el('p', 'editor-help', '选中多个分组后合并，鼠标悬停可实时预览 3D 高亮。'));
    groupList = el('div', 'editor-group-list');
    groupList.id = 'editor-group-list';
    groups.append(groupList);

    const glass = el('div', 'editor-glass');
    const range = el('input');
    range.id = 'editor-glass-opacity';
    range.type = 'range';
    range.min = '0.04';
    range.max = '0.85';
    range.step = '0.01';
    range.value = draft.settings.glassOpacity;
    const output = el('output', 'editor-value', Number(range.value).toFixed(2));
    output.htmlFor = range.id;
    const rangeTitle = el('div', 'editor-range-title');
    const rangeLabel = el('label', '', '玻璃不透明度');
    rangeLabel.htmlFor = range.id;
    rangeTitle.append(rangeLabel, output);
    range.addEventListener('input', () => {
      draft.settings.glassOpacity = Number(range.value);
      output.textContent = Number(range.value).toFixed(2);
    });
    glass.append(rangeTitle, range, el('p', 'editor-help', '用于控制透明/磨砂玻璃材质的基础不透明度。'));
    groups.append(glass);
    body.append(groups);

    const assembly = el('section', 'editor-section');
    const assemblyHeading = el('div', 'editor-section-heading');
    assemblyHeading.append(el('h3', '', '观察装配'));
    const enabled = el('input');
    enabled.id = 'editor-assembly-enabled';
    enabled.type = 'checkbox';
    enabled.setAttribute('role', 'switch');
    enabled.checked = draft.settings.assembly.enabled;
    const toggle = el('label', 'editor-check editor-enable');
    toggle.append(enabled, el('span', '', '在页面显示此功能'));
    assemblyHeading.append(toggle);
    assembly.append(assemblyHeading, el('p', 'editor-help', '让选定分组沿一个方向一起移开。'));
    assemblyFields = el('fieldset', 'editor-assembly-fields');
    assemblyFields.disabled = !enabled.checked;
    enabled.addEventListener('change', () => {
      draft.settings.assembly.enabled = enabled.checked;
      assemblyFields.disabled = !enabled.checked;
    });
    const assemblyRow = el('div', 'editor-assembly-row');
    const axis = optionSelect([['y', 'Y · 上下'], ['x', 'X · 左右'], ['z', 'Z · 前后']], draft.settings.assembly.axis);
    axis.id = 'editor-assembly-axis';
    axis.addEventListener('change', () => { draft.settings.assembly.axis = axis.value; });
    const direction = optionSelect([['1', '正方向（＋）'], ['-1', '反方向（－）']], String(draft.settings.assembly.direction));
    direction.id = 'editor-assembly-direction';
    direction.addEventListener('change', () => { draft.settings.assembly.direction = Number(direction.value); });
    const distance = el('input');
    distance.id = 'editor-assembly-distance';
    distance.type = 'number';
    distance.min = '1';
    distance.max = '1000';
    distance.step = '1';
    distance.value = draft.settings.assembly.distanceMm;
    distance.addEventListener('input', () => { draft.settings.assembly.distanceMm = distance.valueAsNumber; });
    assemblyRow.append(labeled('移动轴', axis), labeled('移动方向', direction), labeled('最大移动距离（mm）', distance));
    assemblyList = el('div', 'editor-assembly-groups');
    assemblyList.id = 'editor-assembly-groups';
    assemblyFields.append(assemblyRow, assemblyList);
    assembly.append(assemblyFields);
    body.append(assembly);

    renderGroups();
    renderAssembly();
  }

  function cancel() {
    if (working) return;
    if (animId) cancelAnimationFrame(animId);
    dialog.close();
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (working) return;
    if (isBusy()) { status('模型正在处理，请稍后再保存。', true); return; }
    try {
      validate();
      busy(true);
      status('正在保存…');
      const settings = normalized();
      await onSave({
        name: draft.name.trim(),
        description: draft.description.trim(),
        category: draft.category || 'Non-builded',
        settings
      });
      cancel();
    } catch (error) {
      status(error?.message || '保存失败，修改仍保留在此窗口，请重试。', true);
    } finally { busy(false); }
  });

  dialog.addEventListener('cancel', event => { event.preventDefault(); cancel(); });

  return {
    open() {
      if (dialog.open || isBusy()) return false;
      context = getContext();
      if (!context?.entry || !Array.isArray(context.meshes) || !context.meshes.length) return false;
      originalSettings = normalizeModelSettings(context.settings, context.meshes, { category: context.entry.category });
      draft = {
        name: context.entry.name || '',
        description: context.entry.description || '',
        category: context.entry.category || 'Non-builded',
        settings: copy(originalSettings),
      };
      selectedGroups = new Set();
      busy(false);
      render();
      status('修改只在保存后生效。');
      dialog.showModal();

      initPreview();

      // 关键修复：延迟 80ms 确保 DOM 完成渲染，规避 WebGL 初始尺寸 0 的问题
      setTimeout(() => {
        updatePreviewAspect();
        updatePreviewScene();
      }, 80);

      fields.scrollTop = 0;
      nameInput.focus();
      return true;
    },
    isOpen: () => dialog.open,
  };
}