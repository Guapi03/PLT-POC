// model-uploader.js
import { parseModel, MAX_FILE_BYTES } from './model-io.js';
import { createModelSettings } from './model-settings.js';
import { supabase } from './supabase-client.js';

function bufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

export function setupUploader({ getCachedModels, onUploadSuccess }) {
    const $ = selector => document.querySelector(selector);

    const fileInput = $('#model-file');
    const nameInput = $('#import-name');
    const categorySelect = $('#import-category');
    const fileCaption = $('#file-caption');
    const importForm = $('#import-form');
    const submitBtn = $('#import-submit');

    if (!importForm) return;

    // 文件选择与名字自动填入
    if (fileInput) {
        fileInput.disabled = false;
        fileInput.addEventListener('change', () => {
            const file = fileInput.files[0];
            if (file) {
                if (fileCaption) {
                    fileCaption.innerHTML = `<span style="color:#7be6cc; font-weight:bold;">已选择: ${file.name}</span>`;
                }
                const cleanName = file.name.replace(/\.glb$/i, '');
                if (nameInput) {
                    nameInput.value = cleanName;
                }
            }
        });
    }

    // 修改按钮默认文案为“上传模型”
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '上传模型';
    }

    // 表单提交逻辑
    importForm.onsubmit = async (e) => {
        e.preventDefault();
        const file = fileInput?.files[0];
        if (!file) return;

        if (file.size > MAX_FILE_BYTES) {
            alert('模型文件过大（超过 25 MiB）');
            return;
        }

        const name = nameInput?.value.trim() || file.name.replace(/\.glb$/i, '');
        const profile = categorySelect?.value || 'generic';

        // 重名检查与覆盖提示
        const cachedModels = getCachedModels ? getCachedModels() : [];
        const existingModel = cachedModels.find(m => m.name === name);

        if (existingModel) {
            const confirmOverwrite = confirm(`模型「${name}」已存在。\n是否覆盖原模型数据？`);
            if (!confirmOverwrite) return;
        }

        // 点击上传后，将按钮状态文字修改为 Model add / 添加模型
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Model add 添加模型';
        }

        try {
            const arrayBuffer = await file.arrayBuffer();
            const gltf = await parseModel(arrayBuffer);

            const meshes = [];
            gltf.scene.traverse(obj => {
                if (obj.isMesh) meshes.push({ id: obj.uuid, name: obj.name });
            });
            const defaultSettings = createModelSettings(meshes, { profile });
            const base64Data = bufferToBase64(arrayBuffer);

            let targetId = null;

            if (existingModel) {
                // 执行覆盖更新 (Update)
                const { error } = await supabase
                    .from('models')
                    .update({
                        file_data: base64Data,
                        settings: defaultSettings,
                        profile: profile
                    })
                    .eq('id', existingModel.id);

                if (error) throw error;
                targetId = existingModel.id;
            } else {
                // 执行新建插入 (Insert)
                const { data, error } = await supabase.from('models').insert([
                    {
                        name: name,
                        description: '用户自定义模型',
                        profile: profile,
                        file_data: base64Data,
                        settings: defaultSettings
                    }
                ]).select();

                if (error) throw error;
                if (data && data[0]) targetId = data[0].id;
            }

            if (fileCaption) fileCaption.textContent = '选择或拖入 GLB 文件';
            importForm.reset();

            // 回调刷新列表与载入模型
            if (onUploadSuccess) {
                await onUploadSuccess(targetId);
            }

            $('#library-dialog')?.close();
        } catch (err) {
            console.error(err);
            alert('上传失败: ' + err.message);
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = '上传模型';
            }
        }
    };
}