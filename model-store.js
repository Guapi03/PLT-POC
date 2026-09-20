// model-store.js
import { parseModel } from './model-io.js';
import { supabase } from './supabase-client.js';
import { populateCategoryOptions } from './model-editor.js';

function base64ToBuffer(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

function bufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    const chunkSize = 0x8000;
    for (let i = 0; i < len; i += chunkSize) {
        const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
        binary += String.fromCharCode.apply(null, chunk);
    }
    return window.btoa(binary);
}

export function saveDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export async function setupLibrary({ activate, getActive, isBusy, onBusyChange }) {
    const $ = selector => document.querySelector(selector);
    let cachedModels = [];
    let filterKeyword = '';
    let filterCategory = 'ALL';

    let sortState = {
        field: 'name',
        direction: 'asc'
    };

    async function fetchModelsFromSupabase() {
        const { data, error } = await supabase
            .from('models')
            .select('*')
            .order('created_at', { ascending: true });
        if (error) throw new Error('读取数据库失败: ' + error.message);
        cachedModels = data || [];
        return cachedModels;
    }

    function getProcessedModels() {
        const kw = filterKeyword.trim().toLowerCase();

        const filtered = cachedModels.filter(m => {
            const cat = String(m.category || m.profile || 'Non-builded');
            const name = String(m.name || '');

            const matchCategory = filterCategory.toUpperCase() === 'ALL' ||
                cat.toLowerCase() === filterCategory.toLowerCase();

            const matchKeyword = !kw || name.toLowerCase().includes(kw) || cat.toLowerCase().includes(kw);

            return matchCategory && matchKeyword;
        });

        return filtered.sort((a, b) => {
            let valA = '';
            let valB = '';

            if (sortState.field === 'name') {
                valA = String(a.name || '').toLowerCase();
                valB = String(b.name || '').toLowerCase();
            } else if (sortState.field === 'category') {
                valA = String(a.category || a.profile || 'Non-builded').toLowerCase();
                valB = String(b.category || b.profile || 'Non-builded').toLowerCase();
            }

            if (valA < valB) return sortState.direction === 'asc' ? -1 : 1;
            if (valA > valB) return sortState.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }

    function toggleSort(field) {
        if (sortState.field === field) {
            sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
        } else {
            sortState.field = field;
            sortState.direction = 'asc';
        }
        renderList();
    }

    function getSortIcon(field) {
        if (sortState.field !== field) return `<span style="opacity: 0.3;">↕</span>`;
        return sortState.direction === 'asc' ? '↓' : '↑';
    }

    function renderHeader(container) {
        const header = document.createElement('div');
        header.className = 'library-table-header';

        const nameHeader = document.createElement('div');
        nameHeader.style.cssText = `cursor: pointer; display: flex; align-items: center; gap: 4px;`;
        nameHeader.innerHTML = `Name ${getSortIcon('name')}`;
        nameHeader.onclick = () => toggleSort('name');

        const catHeader = document.createElement('div');
        catHeader.style.cssText = `cursor: pointer; display: flex; align-items: center; gap: 4px;`;
        catHeader.innerHTML = `Category ${getSortIcon('category')}`;
        catHeader.onclick = () => toggleSort('category');

        const actionHeader = document.createElement('div');
        actionHeader.style.cssText = `text-align: right; padding-right: 4px;`;
        actionHeader.textContent = '操作';

        header.appendChild(nameHeader);
        header.appendChild(catHeader);
        header.appendChild(actionHeader);
        container.appendChild(header);
    }

    function renderList() {
        const listEl = $('#library-list');
        if (!listEl) return;
        listEl.innerHTML = '';

        const processed = getProcessedModels();

        const countEl = $('#library-count');
        if (countEl) countEl.textContent = processed.length;

        renderHeader(listEl);

        if (processed.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.style.cssText = `padding: 24px; color: #8a9ba8; text-align: center;`;
            emptyEl.textContent = '未找到匹配的模型';
            listEl.appendChild(emptyEl);
            return;
        }

        processed.forEach(model => {
            const active = getActive();
            const isActive = active && String(active.id) === String(model.id);

            const item = document.createElement('div');
            item.className = `library-entry ${isActive ? 'active' : ''}`;

            const topGroup = document.createElement('div');
            topGroup.className = 'library-entry-top';

            const nameEl = document.createElement('h3');
            nameEl.textContent = model.name;

            const catEl = document.createElement('span');
            catEl.className = 'category-badge';
            catEl.textContent = model.category || model.profile || 'Non-builded';

            topGroup.appendChild(nameEl);
            topGroup.appendChild(catEl);

            const actionGroup = document.createElement('div');
            actionGroup.className = 'library-actions';

            const useBtn = document.createElement('button');
            useBtn.className = isActive ? 'primary' : 'use-btn';
            useBtn.textContent = isActive ? '当前使用' : '使用';
            useBtn.disabled = isActive;

            useBtn.onclick = async () => {
                if (isBusy() || isActive) return;
                await chooseModel(model.id);
            };

            const editBtn = document.createElement('button');
            editBtn.className = 'edit-btn';
            editBtn.textContent = '编辑';

            editBtn.onclick = async () => {
                if (!isActive) {
                    if (isBusy()) return;
                    await chooseModel(model.id);
                }
                $('#library-dialog')?.close();
                const editBtnMain = $('#edit-model');
                if (editBtnMain) editBtnMain.click();
            };

            const delBtn = document.createElement('button');
            delBtn.className = 'danger';
            delBtn.textContent = '删除';

            delBtn.onclick = async (e) => {
                e.stopPropagation();
                if (isBusy()) return;
                if (!confirm(`确定要删除模型「${model.name}」吗？`)) return;

                try {
                    onBusyChange(true);
                    const { error } = await supabase.from('models').delete().eq('id', model.id);
                    if (error) throw error;

                    await fetchModelsFromSupabase();

                    if (isActive && cachedModels.length > 0) {
                        await chooseModel(cachedModels[0].id);
                    } else if (cachedModels.length === 0) {
                        location.reload();
                    } else {
                        renderList();
                    }
                } catch (err) {
                    alert('删除失败: ' + err.message);
                } finally {
                    onBusyChange(false);
                }
            };

            actionGroup.appendChild(useBtn);
            actionGroup.appendChild(editBtn);
            actionGroup.appendChild(delBtn);

            item.appendChild(topGroup);
            item.appendChild(actionGroup);

            listEl.appendChild(item);
        });
    }

    async function chooseModel(id) {
        onBusyChange(true);
        const msgEl = $('#load-message');
        if (msgEl) msgEl.textContent = '正在加载模型...';
        const loadingEl = $('#loading');
        if (loadingEl) loadingEl.hidden = false;

        try {
            const modelEntry = cachedModels.find(m => String(m.id) === String(id));
            if (!modelEntry) throw new Error('未找到指定模型');

            const arrayBuffer = base64ToBuffer(modelEntry.file_data);
            const gltf = await parseModel(arrayBuffer);

            await activate(modelEntry, gltf);

            const categoryName = modelEntry.category || modelEntry.profile || 'LAB';
            const brandCategoryEl = $('#brand-category');
            if (brandCategoryEl) {
                brandCategoryEl.textContent = categoryName;
            }

            renderList();
        } catch (err) {
            console.error(err);
            alert('加载模型失败: ' + err.message);
        } finally {
            onBusyChange(false);
            if (loadingEl) loadingEl.hidden = true;
        }
    }

    async function saveBytes(id, arrayBuffer) {
        const base64Data = bufferToBase64(arrayBuffer);
        const { error } = await supabase
            .from('models')
            .update({ file_data: base64Data })
            .eq('id', id);
        if (error) throw new Error('保存二进制模型数据失败: ' + error.message);
        await fetchModelsFromSupabase();
    }

    const searchInput = $('#library-search-input');
    if (searchInput) {
        searchInput.value = '';
        searchInput.addEventListener('input', (e) => {
            filterKeyword = e.target.value;
            renderList();
        });
    }

    const categorySelect = $('#library-category-select');
    if (categorySelect) {
        await populateCategoryOptions(categorySelect, 'ALL');

        const defaultOpt = document.createElement('option');
        defaultOpt.value = 'ALL';
        defaultOpt.textContent = '全部分类';
        categorySelect.insertBefore(defaultOpt, categorySelect.firstChild);
        categorySelect.value = 'ALL';

        categorySelect.addEventListener('change', (e) => {
            filterCategory = e.target.value;
            renderList();
        });
    }

    await fetchModelsFromSupabase();
    renderList();

    if (cachedModels.length > 0) {
        await chooseModel(cachedModels[0].id);
    } else {
        const msgEl = $('#load-message');
        if (msgEl) msgEl.textContent = '数据库中暂无模型。';
        const spinner = $('.spinner');
        if (spinner) spinner.hidden = true;
    }

    return {
        list: () => cachedModels,
        choose: chooseModel,
        refresh: async () => {
            await fetchModelsFromSupabase();
            renderList();
        },
        getBytes: async (entry) => base64ToBuffer(entry.file_data),
        saveBytes,
        updateEntry: async (id, patch) => {
            const { data, error } = await supabase
                .from('models')
                .update(patch)
                .eq('id', id)
                .select();
            if (error) throw error;
            await fetchModelsFromSupabase();
            return data[0];
        }
    };
}