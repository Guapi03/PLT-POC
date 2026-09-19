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

    // 当前排序状态 (field: 'name' | 'category', direction: 'asc' | 'desc')
    let sortState = {
        field: 'name',
        direction: 'asc'
    };

    // 从 Supabase 获取全部模型
    async function fetchModelsFromSupabase() {
        const { data, error } = await supabase
            .from('models')
            .select('*')
            .order('created_at', { ascending: true });
        if (error) throw new Error('读取数据库失败: ' + error.message);
        cachedModels = data || [];
        return cachedModels;
    }

    // 获取过滤和排序后的模型列表
    function getProcessedModels() {
        const kw = filterKeyword.trim().toLowerCase();

        // 1. 关键词 + 分类过滤
        const filtered = cachedModels.filter(m => {
            const cat = String(m.category || m.profile || 'Non-builded');
            const name = String(m.name || '');

            const matchCategory = filterCategory.toUpperCase() === 'ALL' ||
                cat.toLowerCase() === filterCategory.toLowerCase();

            const matchKeyword = !kw || name.toLowerCase().includes(kw) || cat.toLowerCase().includes(kw);

            return matchCategory && matchKeyword;
        });

        // 2. 根据 Header 字段排序
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

    // 切换表头排序
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

    // 渲染表头 Header（样式交给 CSS 的 .library-table-header 类控制）
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

    // 渲染模型列表（使用外部 CSS 类名控制）
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

            // 卡片容器：使用 .library-entry 类
            const item = document.createElement('div');
            item.className = `library-entry ${isActive ? 'active' : ''}`;

            // 第一部分：Name + Category 组合容器（适合手机端两行排版的顶部）
            const topGroup = document.createElement('div');
            topGroup.className = 'library-entry-top';

            // 1. Name 显示
            const nameEl = document.createElement('h3');
            nameEl.textContent = model.name;

            // 2. Category 显示
            const catEl = document.createElement('span');
            catEl.className = 'category-badge';
            catEl.textContent = model.category || model.profile || 'Non-builded';

            topGroup.appendChild(nameEl);
            topGroup.appendChild(catEl);

            // 3. 操作按钮组：使用 .library-actions 类
            const actionGroup = document.createElement('div');
            actionGroup.className = 'library-actions';

            // 使用 / 当前使用 按钮
            const useBtn = document.createElement('button');
            if (isActive) {
                useBtn.className = 'primary';
            }
            useBtn.textContent = isActive ? '当前使用' : '使用';
            useBtn.disabled = isActive;

            useBtn.onclick = async () => {
                if (isBusy() || isActive) return;
                await chooseModel(model.id);
            };

            // 编辑按钮
            const editBtn = document.createElement('button');
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

            // 删除按钮
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

            // 把组组装到 item 中
            item.appendChild(topGroup);
            item.appendChild(actionGroup);

            listEl.appendChild(item);
        });
    }

    // 选择并加载模型，同时更新左上角 GLASS / <Category> 名称
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

            // 动态更新左上角 GLASS / <Category Name>
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

    // 绑定搜索框
    const searchInput = $('#library-search-input');
    if (searchInput) {
        searchInput.value = '';
        searchInput.addEventListener('input', (e) => {
            filterKeyword = e.target.value;
            renderList();
        });
    }

    // 绑定类型全部分类下拉框
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

    // 初始化获取数据并渲染
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