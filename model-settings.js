// Presentation metadata only: grouping never joins or changes the GLB geometry.
export const MATERIAL_PRESETS = ['auto', 'original', 'glass', 'frosted', 'solid'];
const BOTTLE_GROUPS = [
  ['bottle', '瓶身', '盛装液体的玻璃容器。瓶口开放，瓶底封闭；容量与尺寸尚未实测校准。'],
  ['head', '磨口上盖', '通过 24/29 磨口与瓶身连接。抬起上盖时，两条导管会一起移动。'],
  ['long', '长导管', '延伸到瓶底附近的独立通道。隐藏瓶身后，可以更清楚地观察管路。'],
  ['short', '短导管', '与瓶内上部空间相通，与长导管保持独立。'],
];

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function text(value, fallback, limit) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : fallback;
}
function number(value, fallback, min, max) {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '') return fallback;
  const result = Number(value);
  return Number.isFinite(result) ? Math.min(max, Math.max(min, result)) : fallback;
}
function meshList(meshes) {
  const seen = new Set();
  return (Array.isArray(meshes) ? meshes : []).filter(mesh => {
    if (!mesh || typeof mesh.id !== 'string' || !mesh.id || seen.has(mesh.id)) return false;
    seen.add(mesh.id);
    return true;
  }).map(mesh => ({ id: mesh.id, name: typeof mesh.name === 'string' ? mesh.name : '' }));
}
function shortName(name, fallback) {
  // Blender export names often include a Chinese label followed by an English description.
  const first = String(name || '').split(/[|｜]/)[0]
    .replace(/(?:_?export)(?:[._-]?\d+)?$/i, '')
    .replace(/^[\s_-]+|[\s_-]+$/g, '')
    .replace(/_+/g, ' ');
  return text(first, fallback, 80);
}
function uniqueId(preferred, used) {
  const valid = typeof preferred === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(preferred)
    && !['constructor', 'prototype', '__proto__'].includes(preferred);
  const base = valid ? preferred : 'g';
  let id = base, suffix = 1;
  while (used.has(id)) id = base.slice(0, 56) + '-' + suffix++;
  used.add(id);
  return id;
}
function references(value, groups, remap = new Map()) {
  const valid = new Set(groups.filter(group => group.meshIds.length).map(group => group.id));
  const result = [];
  for (const id of Array.isArray(value) ? value : []) {
    if (typeof id !== 'string') continue;
    const mapped = remap.get(id) || [id];
    for (const candidate of mapped) if (valid.has(candidate) && !result.includes(candidate)) result.push(candidate);
  }
  return result;
}
function defaults(meshes, profile) {
  let groups;
  if (profile === 'bottle') {
    groups = BOTTLE_GROUPS.map(([id, name, description]) => ({ id, name, description, meshIds: [], preset: 'auto' }));
    for (const mesh of meshes) {
      const id = mesh.name.includes('上盖') ? 'head' : mesh.name.includes('长导管') ? 'long'
        : mesh.name.includes('短导管') ? 'short' : 'bottle';
      groups.find(group => group.id === id).meshIds.push(mesh.id);
    }
    groups = groups.filter(group => group.meshIds.length);
  } else {
    groups = meshes.map((mesh, index) => ({
      id: 'g-' + index, name: shortName(mesh.name, '部件 ' + (index + 1)),
      description: '', meshIds: [mesh.id], preset: 'auto',
    }));
  }
  const movingGroupIds = profile === 'bottle' ? references(['head', 'long', 'short'], groups) : [];
  return {
    version: 1, groups, glassOpacity: 0.18,
    assembly: {
      enabled: profile === 'bottle' && movingGroupIds.length > 0,
      movingGroupIds, hiddenGroupIds: profile === 'bottle' ? references(['bottle'], groups) : [],
      axis: 'y', direction: 1, distanceMm: 180,
    },
  };
}

export function createModelSettings(meshes, { profile = 'generic' } = {}) {
  return defaults(meshList(meshes), profile);
}

export function normalizeModelSettings(raw, meshes, { profile = 'generic' } = {}) {
  const list = meshList(meshes), fallback = defaults(list, profile), input = object(raw);
  const sourceGroups = Array.isArray(input.groups) ? input.groups : fallback.groups;
  const known = new Set(list.map(mesh => mesh.id)), assigned = new Set(), used = new Set(), remap = new Map();
  const groups = [];
  for (const item of sourceGroups) {
    const group = object(item), meshIds = [];
    for (const id of Array.isArray(group.meshIds) ? group.meshIds : []) {
      if (typeof id === 'string' && known.has(id) && !assigned.has(id)) {
        meshIds.push(id);
        assigned.add(id);
      }
    }
    if (!meshIds.length) continue;
    const id = uniqueId(group.id, used);
    if (typeof group.id === 'string' && !remap.has(group.id)) remap.set(group.id, [id]);
    const defaultGroup = fallback.groups.find(candidate => candidate.id === group.id);
    const firstMesh = list.find(mesh => mesh.id === meshIds[0]);
    groups.push({
      id, name: text(group.name, defaultGroup?.name || shortName(firstMesh?.name, '部件 ' + (groups.length + 1)), 80),
      description: typeof group.description === 'string' ? group.description.trim().slice(0, 300) : defaultGroup?.description || '',
      meshIds, preset: MATERIAL_PRESETS.includes(group.preset) ? group.preset : 'auto',
    });
  }
  // New meshes become their own visible group without disturbing the user's existing groups.
  for (const mesh of list) if (!assigned.has(mesh.id)) {
    groups.push({ id: uniqueId('g-' + groups.length, used), name: shortName(mesh.name, '部件 ' + (groups.length + 1)),
      description: '', meshIds: [mesh.id], preset: 'auto' });
    assigned.add(mesh.id);
  }
  const assembly = object(input.assembly), base = fallback.assembly;
  const movingGroupIds = references(assembly.movingGroupIds === undefined ? base.movingGroupIds : assembly.movingGroupIds, groups, remap);
  const hiddenGroupIds = references(assembly.hiddenGroupIds === undefined ? base.hiddenGroupIds : assembly.hiddenGroupIds, groups, remap);
  return {
    version: 1, groups, glassOpacity: number(input.glassOpacity, fallback.glassOpacity, 0.04, 0.85),
    assembly: {
      enabled: (typeof assembly.enabled === 'boolean' ? assembly.enabled : base.enabled) && movingGroupIds.length > 0,
      movingGroupIds, hiddenGroupIds,
      axis: ['x', 'y', 'z'].includes(assembly.axis) ? assembly.axis : base.axis,
      direction: assembly.direction === -1 || assembly.direction === '-1' ? -1 : 1,
      distanceMm: number(assembly.distanceMm, base.distanceMm, 1, 1000),
    },
  };
}

function copySettings(settings) {
  const input = object(settings);
  const meshes = (Array.isArray(input.groups) ? input.groups : []).flatMap(group =>
    (Array.isArray(group?.meshIds) ? group.meshIds : []).map(id => ({ id, name: group.name })));
  return normalizeModelSettings(input, meshes);
}
function remapAssembly(settings, remap) {
  settings.assembly.movingGroupIds = references(settings.assembly.movingGroupIds, settings.groups, remap);
  settings.assembly.hiddenGroupIds = references(settings.assembly.hiddenGroupIds, settings.groups, remap);
  settings.assembly.enabled = settings.assembly.enabled && settings.assembly.movingGroupIds.length > 0;
  return settings;
}

export function mergeGroups(settings, ids, name) {
  const result = copySettings(settings), selected = new Set(Array.isArray(ids) ? ids : []);
  const groups = result.groups.filter(group => selected.has(group.id));
  if (!groups.length) return result;
  const target = groups[0];
  target.name = text(name, target.name, 80);
  target.meshIds = groups.flatMap(group => group.meshIds);
  result.groups = result.groups.filter(group => !selected.has(group.id) || group.id === target.id);
  return remapAssembly(result, new Map(groups.map(group => [group.id, [target.id]])));
}

export function splitGroup(settings, id, meshes) {
  const result = copySettings(settings), group = result.groups.find(candidate => candidate.id === id);
  if (!group || group.meshIds.length < 2) return result;
  const names = new Map(meshList(meshes).map(mesh => [mesh.id, mesh.name]));
  const used = new Set(result.groups.map(candidate => candidate.id));
  const split = group.meshIds.map((meshId, index) => ({
    id: uniqueId(group.id + '-' + (index + 1), used),
    name: shortName(names.get(meshId), group.name + ' ' + (index + 1)),
    description: group.description, meshIds: [meshId], preset: group.preset,
  }));
  result.groups.splice(result.groups.indexOf(group), 1, ...split);
  return remapAssembly(result, new Map([[group.id, split.map(candidate => candidate.id)]]));
}
