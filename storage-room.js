(function () {
    'use strict';

    const ROOM_KEY = 'wardrobe_storage_rooms_v1';
    const MODE_KEY = 'wardrobe_workspace_mode_v1';
    const COLLAPSE_KEY = 'wardrobe_storage_collapse_v1';
    const MAX_SCENE_EDGE = 1920;
    const state = {
        rooms: [],
        activeRoomId: null,
        interaction: 'browse',
        selectedMarkerId: null,
        selectedItemId: null,
        trackingMarkerId: null,
        trackingItemId: null,
        zoom: 1,
        initialized: false,
        rendered: false,
        dirty: true,
        saveTimer: 0,
        toastTimer: 0,
        trackingTimer: 0,
        trayQuery: '',
        sceneLibraryCollapsed: false,
        trayCollapsed: false
    };

    const $ = (selector, root = document) => root.querySelector(selector);
    const getInventory = () => Array.isArray(window.inventory) ? window.inventory : (typeof inventory !== 'undefined' && Array.isArray(inventory) ? inventory : []);
    const idString = value => String(value);
    const uid = prefix => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    function safeText(value) {
        return value == null ? '' : String(value);
    }

    function currentRoom() {
        return state.rooms.find(room => room.id === state.activeRoomId) || null;
    }

    function currentMarker() {
        const room = currentRoom();
        return room && room.markers.find(marker => marker.id === state.selectedMarkerId) || null;
    }

    function normalizeRooms(value) {
        if (!Array.isArray(value)) return [];
        return value.map((raw, roomIndex) => ({
            id: safeText(raw.id || uid('room')),
            name: safeText(raw.name || `储物间 ${roomIndex + 1}`),
            image: typeof raw.image === 'string' ? raw.image : '',
            thumbnail: typeof raw.thumbnail === 'string' ? raw.thumbnail : '',
            createdAt: Number(raw.createdAt) || Date.now(),
            updatedAt: Number(raw.updatedAt) || Date.now(),
            markers: Array.isArray(raw.markers) ? raw.markers.map((marker, markerIndex) => ({
                id: safeText(marker.id || uid('marker')),
                name: safeText(marker.name || `位置 ${markerIndex + 1}`),
                x: Math.min(100, Math.max(0, Number(marker.x) || 50)),
                y: Math.min(100, Math.max(0, Number(marker.y) || 50)),
                itemIds: Array.isArray(marker.itemIds) ? [...new Set(marker.itemIds.map(idString))] : []
            })) : []
        }));
    }

    function buildShell() {
        const content = $('.layout-content');
        const filter = content && $('.filter-sticky', content);
        if (!content || !filter || $('#storageRoomMode')) return;

        const modeBar = document.createElement('nav');
        modeBar.className = 'workspace-mode-bar';
        modeBar.setAttribute('aria-label', '工作区模式');
        modeBar.innerHTML = `
            <button class="workspace-mode-btn active" type="button" data-workspace-mode="inventory">📦 物品库</button>
            <button class="workspace-mode-btn" type="button" data-workspace-mode="storage">🗺️ 储物间</button>`;
        content.insertBefore(modeBar, filter);

        const section = document.createElement('section');
        section.id = 'storageRoomMode';
        section.className = 'storage-room-mode';
        section.hidden = true;
        section.innerHTML = `
            <div class="storage-toolbar">
                <select class="storage-room-select" id="storageRoomSelect" aria-label="选择储物间"></select>
                <button class="storage-icon-btn" id="storageNewRoom" type="button" title="新建储物间">＋</button>
                <button class="storage-icon-btn" id="storageRenameRoom" type="button" title="重命名">✎</button>
                <button class="storage-icon-btn" id="storageDeleteRoom" type="button" title="删除当前储物间">🗑️</button>
                <div class="storage-mode-segment" role="group" aria-label="储物间操作模式">
                    <button class="storage-btn active" type="button" data-storage-interaction="browse">👁 浏览</button>
                    <button class="storage-btn" type="button" data-storage-interaction="edit">📍 编辑位置</button>
                </div>
                <button class="storage-btn primary" id="storageChangeScene" type="button">🖼️ 上传场景</button>
                <input id="storageSceneFile" type="file" accept="image/*" hidden>
            </div>
            <div class="storage-scene-library">
                <div class="storage-scene-library-head">
                    <strong>场景导航</strong>
                    <span>点击照片快速切换储物间</span>
                    <button class="storage-collapse-btn" id="storageSceneLibraryToggle" type="button" aria-controls="storageSceneStrip" aria-expanded="true">收起⌃</button>
                </div>
                <div class="storage-scene-strip" id="storageSceneStrip"></div>
            </div>
            <div class="storage-workspace">
                <div class="storage-canvas-card">
                    <div class="storage-canvas-head">
                        <strong id="storageSceneTitle">尚未创建储物间</strong>
                        <span class="storage-hint" id="storageSceneHint">先新建储物间并上传场景照片</span>
                    </div>
                    <div class="storage-scene-stage" id="storageSceneStage"></div>
                </div>
                <aside class="storage-location-drawer" id="storageLocationDrawer" aria-label="位置内容">
                    <div class="storage-drawer-head">
                        <strong id="storageDrawerTitle">位置详情</strong>
                        <button class="storage-icon-btn storage-drawer-close" id="storageDrawerClose" type="button" aria-label="关闭位置详情">×</button>
                    </div>
                    <div class="storage-drawer-body" id="storageDrawerBody"></div>
                </aside>
            </div>
            <div class="storage-unplaced-section">
                <div class="storage-tray-head">
                    <strong>待放置物品 <span class="storage-tray-count" id="storageTrayCount"></span></strong>
                    <button class="storage-collapse-btn" id="storageTrayToggle" type="button" aria-controls="storageUnplacedTray" aria-expanded="true">收起⌃</button>
                    <span class="storage-hint" id="storageTrayHint">编辑位置时，可拖到标记点或依次点击物品和标记点</span>
                    <input class="storage-tray-search" id="storageTraySearch" type="search" placeholder="搜索待放置物品…">
                </div>
                <div class="storage-unplaced-tray" id="storageUnplacedTray"></div>
            </div>
            <div class="storage-toast" id="storageToast" role="status" aria-live="polite"></div>
            <dialog class="storage-name-dialog" id="storageNameDialog">
                <form class="storage-name-form" id="storageNameForm">
                    <strong id="storageNameTitle">储物间名称</strong>
                    <input class="storage-marker-name-input" id="storageNameInput" maxlength="30" autocomplete="off" required>
                    <div class="storage-name-actions">
                        <button class="storage-btn" id="storageNameCancel" type="button">取消</button>
                        <button class="storage-btn primary" type="submit">确定</button>
                    </div>
                </form>
            </dialog>`;
        content.appendChild(section);
    }

    function bindShell() {
        document.addEventListener('click', event => {
            const workspaceButton = event.target.closest('[data-workspace-mode]');
            if (workspaceButton) setWorkspaceMode(workspaceButton.dataset.workspaceMode);

            const interactionButton = event.target.closest('[data-storage-interaction]');
            if (interactionButton) setInteraction(interactionButton.dataset.storageInteraction);
        });

        $('#storageRoomSelect').addEventListener('change', event => {
            activateRoom(event.target.value || null);
        });
        $('#storageNewRoom').addEventListener('click', createRoom);
        $('#storageRenameRoom').addEventListener('click', renameRoom);
        $('#storageDeleteRoom').addEventListener('click', deleteRoom);
        $('#storageChangeScene').addEventListener('click', async () => {
            if (!currentRoom()) await createRoom();
            if (currentRoom()) $('#storageSceneFile').click();
        });
        $('#storageSceneFile').addEventListener('change', uploadScene);
        $('#storageDrawerClose').addEventListener('click', closeDrawer);
        $('#storageSceneLibraryToggle').addEventListener('click', () => {
            state.sceneLibraryCollapsed = !state.sceneLibraryCollapsed;
            applyCollapseState(true);
        });
        $('#storageTrayToggle').addEventListener('click', () => {
            state.trayCollapsed = !state.trayCollapsed;
            applyCollapseState(true);
        });
        $('#storageTraySearch').addEventListener('input', event => {
            state.trayQuery = event.target.value.trim().toLowerCase();
            renderTray();
        });
    }

    async function initStorageRoomMode() {
        if (state.initialized) return;
        buildShell();
        bindShell();
        try {
            state.rooms = normalizeRooms(await localforage.getItem(ROOM_KEY));
        } catch (error) {
            console.error('读取储物间数据失败', error);
            state.rooms = [];
        }
        state.activeRoomId = state.rooms[0] ? state.rooms[0].id : null;
        try {
            const collapse = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}');
            state.sceneLibraryCollapsed = collapse.sceneLibrary === true;
            state.trayCollapsed = collapse.tray === true;
        } catch (_) {}
        if (cleanDanglingItems()) await saveRooms(true);
        state.initialized = true;
        applyCollapseState(false);
        setWorkspaceMode(localStorage.getItem(MODE_KEY) === 'storage' ? 'storage' : 'inventory', false);
    }

    function applyCollapseState(persist) {
        const library = $('.storage-scene-library');
        const traySection = $('.storage-unplaced-section');
        const libraryButton = $('#storageSceneLibraryToggle');
        const trayButton = $('#storageTrayToggle');
        library?.classList.toggle('is-collapsed', state.sceneLibraryCollapsed);
        traySection?.classList.toggle('is-collapsed', state.trayCollapsed);
        if (libraryButton) {
            libraryButton.textContent = state.sceneLibraryCollapsed ? '展开⌄' : '收起⌃';
            libraryButton.setAttribute('aria-expanded', String(!state.sceneLibraryCollapsed));
        }
        if (trayButton) {
            trayButton.textContent = state.trayCollapsed ? '展开⌄' : '收起⌃';
            trayButton.setAttribute('aria-expanded', String(!state.trayCollapsed));
        }
        if (persist) {
            localStorage.setItem(COLLAPSE_KEY, JSON.stringify({
                sceneLibrary: state.sceneLibraryCollapsed,
                tray: state.trayCollapsed
            }));
        }
    }

    function setWorkspaceMode(mode, persist = true) {
        const storage = mode === 'storage';
        const content = $('.layout-content');
        const section = $('#storageRoomMode');
        if (!content || !section) return;
        content.classList.toggle('storage-mode-active', storage);
        section.hidden = !storage;
        document.querySelectorAll('[data-workspace-mode]').forEach(button => {
            const active = button.dataset.workspaceMode === mode;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
        });
        if (persist) localStorage.setItem(MODE_KEY, mode);
        if (storage) {
            if (!state.rendered || state.dirty) renderStorageRoom();
            requestAnimationFrame(() => $('#storageRoomSelect')?.focus({ preventScroll: true }));
        } else {
            closeDrawer();
        }
    }

    function setInteraction(mode) {
        state.interaction = mode === 'edit' ? 'edit' : 'browse';
        state.selectedItemId = null;
        syncInteractionButtons();
        renderDrawer();
    }

    function syncInteractionButtons() {
        document.querySelectorAll('[data-storage-interaction]').forEach(button => {
            const active = button.dataset.storageInteraction === state.interaction;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
        });
        const room = currentRoom();
        $('#storageSceneHint').textContent = state.interaction === 'edit'
            ? (room?.image ? '点击照片空白处添加标记；拖动标记可调整位置' : '上传场景照片后即可添加位置')
            : '悬停或点击标记查看物品';
        $('#storageTrayHint').textContent = state.interaction === 'edit'
            ? '拖到标记点，或先点物品再点标记点'
            : '未关联到任何位置的物品';
        document.querySelectorAll('.storage-tray-card').forEach(card => { card.draggable = state.interaction === 'edit'; });
    }

    async function createRoom() {
        const proposed = await askRoomName('新建储物间', `储物间 ${state.rooms.length + 1}`);
        if (proposed == null) return;
        const name = proposed.trim() || `储物间 ${state.rooms.length + 1}`;
        const room = { id: uid('room'), name, image: '', thumbnail: '', markers: [], createdAt: Date.now(), updatedAt: Date.now() };
        state.rooms.push(room);
        state.activeRoomId = room.id;
        state.selectedMarkerId = null;
        state.selectedItemId = null;
        await saveRooms(true);
        renderStorageRoom();
        showToast(`已创建「${name}」`);
        return room;
    }

    async function renameRoom() {
        const room = currentRoom();
        if (!room) return showToast('请先新建储物间');
        const proposed = await askRoomName('重命名储物间', room.name);
        if (proposed == null || !proposed.trim()) return;
        room.name = proposed.trim();
        room.updatedAt = Date.now();
        saveRooms(true);
        renderStorageRoom();
    }

    function askRoomName(title, value) {
        const dialog = $('#storageNameDialog');
        const form = $('#storageNameForm');
        const input = $('#storageNameInput');
        $('#storageNameTitle').textContent = title;
        input.value = value;
        return new Promise(resolve => {
            const finish = result => {
                form.removeEventListener('submit', submit);
                $('#storageNameCancel').removeEventListener('click', cancel);
                dialog.removeEventListener('cancel', cancel);
                if (dialog.open) dialog.close();
                resolve(result);
            };
            const submit = event => {
                event.preventDefault();
                if (input.reportValidity()) finish(input.value);
            };
            const cancel = event => {
                event.preventDefault();
                finish(null);
            };
            form.addEventListener('submit', submit);
            $('#storageNameCancel').addEventListener('click', cancel);
            dialog.addEventListener('cancel', cancel);
            dialog.showModal();
            requestAnimationFrame(() => input.select());
        });
    }

    function deleteRoom() {
        const room = currentRoom();
        if (!room) return;
        if (!window.confirm(`确定删除「${room.name}」吗？场景图和位置标记也会删除，物品本身不会丢失。`)) return;
        state.rooms = state.rooms.filter(item => item.id !== room.id);
        state.activeRoomId = state.rooms[0] ? state.rooms[0].id : null;
        state.selectedMarkerId = null;
        state.selectedItemId = null;
        saveRooms(true);
        renderStorageRoom();
        showToast('储物间已删除，物品仍保留在物品库');
    }

    async function uploadScene(event) {
        const file = event.target.files && event.target.files[0];
        event.target.value = '';
        if (!file) return;
        const room = currentRoom();
        if (!room) return;
        showToast('正在压缩场景照片…');
        try {
            const scene = await compressScene(file);
            room.image = scene.image;
            room.thumbnail = scene.thumbnail;
            room.updatedAt = Date.now();
            state.zoom = 1;
            await saveRooms(true);
            renderStorageRoom();
            showToast('场景照片已保存');
        } catch (error) {
            console.error('场景照片处理失败', error);
            window.alert(`场景照片处理失败：${error.message}`);
        }
    }

    function compressScene(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('无法读取图片'));
            reader.onload = () => {
                const image = new Image();
                image.onerror = () => reject(new Error('图片格式不受支持'));
                image.onload = () => {
                    const makeVariant = (maxEdge, quality) => {
                        const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
                        const canvas = document.createElement('canvas');
                        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
                        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
                        const context = canvas.getContext('2d', { alpha: false });
                        context.imageSmoothingEnabled = true;
                        context.imageSmoothingQuality = 'high';
                        context.drawImage(image, 0, 0, canvas.width, canvas.height);
                        return canvas.toDataURL('image/webp', quality);
                    };
                    resolve({
                        image: makeVariant(MAX_SCENE_EDGE, .74),
                        thumbnail: makeVariant(320, .62)
                    });
                };
                image.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    function renderStorageRoom() {
        if (!state.initialized || !$('#storageRoomMode')) return;
        renderRoomSelect();
        renderSceneStrip();
        renderScene();
        renderDrawer();
        renderTray();
        $('#storageRenameRoom').disabled = !currentRoom();
        $('#storageDeleteRoom').disabled = !currentRoom();
        $('#storageChangeScene').textContent = currentRoom()?.image ? '🖼️ 更换场景' : '🖼️ 上传场景';
        syncInteractionButtons();
        applyCollapseState(false);
        state.rendered = true;
        state.dirty = false;
    }

    function renderRoomSelect() {
        const select = $('#storageRoomSelect');
        select.replaceChildren();
        if (!state.rooms.length) {
            select.append(new Option('尚无储物间', ''));
            select.disabled = true;
            return;
        }
        select.disabled = false;
        state.rooms.forEach(room => select.append(new Option(room.name, room.id, false, room.id === state.activeRoomId)));
    }

    function activateRoom(roomId) {
        state.activeRoomId = roomId;
        state.selectedMarkerId = null;
        state.selectedItemId = null;
        state.trackingMarkerId = null;
        state.trackingItemId = null;
        state.zoom = 1;
        renderStorageRoom();
    }

    function renderSceneStrip() {
        const strip = $('#storageSceneStrip');
        strip.replaceChildren();
        const fragment = document.createDocumentFragment();
        state.rooms.forEach(room => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = `storage-scene-thumb${room.id === state.activeRoomId ? ' active' : ''}`;
            card.setAttribute('aria-label', `切换到${room.name}`);
            card.title = `${room.name} · ${room.markers.length}个位置`;
            if (room.thumbnail || room.image) {
                const image = document.createElement('img');
                image.src = room.thumbnail || room.image;
                image.alt = '';
                image.loading = 'lazy';
                image.decoding = 'async';
                card.append(image);
            } else {
                const placeholder = document.createElement('span');
                placeholder.className = 'storage-scene-thumb-placeholder';
                placeholder.textContent = '🏠';
                card.append(placeholder);
            }
            const caption = document.createElement('span');
            caption.className = 'storage-scene-thumb-caption';
            const name = document.createElement('b');
            name.textContent = room.name;
            const count = document.createElement('small');
            count.textContent = `${room.markers.length}个位置`;
            caption.append(name, count);
            card.append(caption);
            card.addEventListener('click', () => activateRoom(room.id));
            fragment.append(card);
        });
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'storage-scene-thumb storage-scene-thumb-add';
        add.innerHTML = '<span>＋</span><b>添加新场景</b>';
        add.addEventListener('click', async () => {
            const room = await createRoom();
            if (room) $('#storageSceneFile').click();
        });
        fragment.append(add);
        strip.append(fragment);
    }

    function renderScene() {
        const stage = $('#storageSceneStage');
        const room = currentRoom();
        $('#storageSceneTitle').textContent = room ? `🗺️ ${room.name}` : '尚未创建储物间';
        $('#storageSceneHint').textContent = state.interaction === 'edit'
            ? (room?.image ? '点击照片空白处添加标记；拖动标记可调整位置' : '上传场景照片后即可添加位置')
            : '悬停或点击标记查看物品';
        stage.replaceChildren();

        if (!room || !room.image) {
            const empty = document.createElement('div');
            empty.className = 'storage-empty-scene';
            empty.innerHTML = `<div class="storage-empty-icon">🏠</div><strong>${room ? '上传一张储物间场景照片' : '先创建你的第一个储物间'}</strong><p>照片只会压缩保存一次；物品卡片通过标记点关联，不复制原图。</p>`;
            const action = document.createElement('button');
            action.type = 'button';
            action.className = 'storage-btn primary';
            action.textContent = room ? '🖼️ 选择场景照片' : '＋ 新建储物间';
            action.addEventListener('click', room ? () => $('#storageSceneFile').click() : createRoom);
            empty.append(action);
            stage.append(empty);
            return;
        }

        const frame = document.createElement('div');
        frame.className = 'storage-scene-frame';
        frame.id = 'storageSceneFrame';
        frame.style.setProperty('--storage-zoom', state.zoom);
        const image = document.createElement('img');
        image.className = 'storage-scene-image';
        image.alt = `${room.name}场景`;
        image.draggable = false;
        image.src = room.image;
        const layer = document.createElement('div');
        layer.className = 'storage-marker-layer';
        layer.id = 'storageMarkerLayer';
        frame.append(image, layer);
        stage.append(frame);
        room.markers.forEach((marker, index) => layer.append(buildMarker(marker, index)));
        frame.addEventListener('click', addMarkerFromScene);

        const zoom = document.createElement('div');
        zoom.className = 'storage-zoom-controls';
        zoom.innerHTML = '<button type="button" data-zoom="out" aria-label="缩小">−</button><button type="button" data-zoom="reset" aria-label="重置缩放">1:1</button><button type="button" data-zoom="in" aria-label="放大">＋</button>';
        zoom.addEventListener('click', event => {
            const action = event.target.closest('[data-zoom]')?.dataset.zoom;
            if (!action) return;
            if (action === 'in') state.zoom = Math.min(1.8, +(state.zoom + .15).toFixed(2));
            if (action === 'out') state.zoom = Math.max(.55, +(state.zoom - .15).toFixed(2));
            if (action === 'reset') state.zoom = 1;
            frame.style.setProperty('--storage-zoom', state.zoom);
        });
        stage.append(zoom);
    }

    function buildMarker(marker, index) {
        const wrap = document.createElement('div');
        wrap.className = `storage-marker-wrap${marker.id === state.trackingMarkerId ? ' is-tracking' : ''}`;
        wrap.dataset.markerId = marker.id;
        wrap.style.left = `${marker.x}%`;
        wrap.style.top = `${marker.y}%`;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `storage-marker${marker.id === state.selectedMarkerId ? ' selected' : ''}`;
        button.dataset.markerId = marker.id;
        button.setAttribute('aria-label', `${marker.name}，${marker.itemIds.length}件物品`);
        button.innerHTML = `<span>${marker.itemIds.length || index + 1}</span>`;
        button.addEventListener('click', event => {
            event.stopPropagation();
            selectOrAssignMarker(marker.id);
        });
        button.addEventListener('dragover', event => {
            if (state.interaction !== 'edit') return;
            event.preventDefault();
            button.classList.add('drag-over');
        });
        button.addEventListener('dragleave', () => button.classList.remove('drag-over'));
        button.addEventListener('drop', event => {
            event.preventDefault();
            button.classList.remove('drag-over');
            const itemId = event.dataTransfer.getData('text/plain');
            if (itemId) assignItemToMarker(itemId, marker.id);
        });
        bindMarkerMove(button, marker, wrap);
        wrap.append(button, buildPopover(marker));
        return wrap;
    }

    function buildPopover(marker) {
        const popover = document.createElement('div');
        popover.className = 'storage-marker-popover';
        const title = document.createElement('div');
        title.className = 'storage-popover-title';
        title.textContent = `${marker.name} · ${marker.itemIds.length}件`;
        popover.append(title);
        marker.itemIds.slice(0, 3).map(findItem).filter(Boolean).forEach(item => {
            const row = document.createElement('div');
            row.className = 'storage-popover-row';
            row.append(itemVisual(item, 'storage-mini-placeholder'));
            const name = document.createElement('span');
            name.textContent = item.name || '未命名物品';
            row.append(name);
            popover.append(row);
        });
        if (!marker.itemIds.length) {
            const empty = document.createElement('div');
            empty.className = 'storage-popover-more';
            empty.textContent = '这里还没有放置物品';
            popover.append(empty);
        } else if (marker.itemIds.length > 3) {
            const more = document.createElement('div');
            more.className = 'storage-popover-more';
            more.textContent = `另有 ${marker.itemIds.length - 3} 件，点击查看`;
            popover.append(more);
        }
        return popover;
    }

    function addMarkerFromScene(event) {
        if (state.interaction !== 'edit' || event.target.closest('.storage-marker-wrap')) return;
        const room = currentRoom();
        const frame = $('#storageSceneFrame');
        if (!room || !frame) return;
        const rect = frame.getBoundingClientRect();
        const x = Math.min(98, Math.max(2, (event.clientX - rect.left) / rect.width * 100));
        const y = Math.min(98, Math.max(2, (event.clientY - rect.top) / rect.height * 100));
        const marker = { id: uid('marker'), name: `位置 ${room.markers.length + 1}`, x, y, itemIds: [] };
        room.markers.push(marker);
        room.updatedAt = Date.now();
        state.selectedMarkerId = marker.id;
        saveRooms();
        renderStorageRoom();
        openDrawer();
    }

    function bindMarkerMove(button, marker, wrap) {
        let pointerId = null;
        let moved = false;
        let startX = 0;
        let startY = 0;
        button.addEventListener('pointerdown', event => {
            if (state.interaction !== 'edit') return;
            pointerId = event.pointerId;
            moved = false;
            startX = event.clientX;
            startY = event.clientY;
            button.setPointerCapture(pointerId);
        });
        button.addEventListener('pointermove', event => {
            if (pointerId !== event.pointerId || state.interaction !== 'edit') return;
            if (Math.hypot(event.clientX - startX, event.clientY - startY) < 5 && !moved) return;
            moved = true;
            event.preventDefault();
            const frame = $('#storageSceneFrame');
            if (!frame) return;
            const rect = frame.getBoundingClientRect();
            marker.x = Math.min(98, Math.max(2, (event.clientX - rect.left) / rect.width * 100));
            marker.y = Math.min(98, Math.max(2, (event.clientY - rect.top) / rect.height * 100));
            wrap.style.left = `${marker.x}%`;
            wrap.style.top = `${marker.y}%`;
        });
        const finish = event => {
            if (pointerId !== event.pointerId) return;
            if (moved) {
                currentRoom().updatedAt = Date.now();
                saveRooms();
            }
            pointerId = null;
        };
        button.addEventListener('pointerup', finish);
        button.addEventListener('pointercancel', finish);
    }

    function selectOrAssignMarker(markerId) {
        if (state.interaction === 'edit' && state.selectedItemId != null) {
            assignItemToMarker(state.selectedItemId, markerId);
            return;
        }
        state.selectedMarkerId = markerId;
        document.querySelectorAll('.storage-marker').forEach(button => button.classList.toggle('selected', button.dataset.markerId === markerId));
        renderDrawer();
        openDrawer();
    }

    function renderDrawer() {
        const body = $('#storageDrawerBody');
        const marker = currentMarker();
        body.replaceChildren();
        if (!marker) {
            $('#storageDrawerTitle').textContent = '位置详情';
            const empty = document.createElement('div');
            empty.className = 'storage-drawer-empty';
            empty.textContent = currentRoom()?.markers.length ? '点击场景中的标记点查看物品' : '切换到“编辑位置”，点击场景照片添加第一个标记点';
            body.append(empty);
            return;
        }
        $('#storageDrawerTitle').textContent = `${marker.name} · ${marker.itemIds.length}件`;
        if (state.interaction === 'edit') body.append(buildMarkerEditor(marker));
        const list = document.createElement('div');
        list.className = 'storage-drawer-list';
        const items = marker.itemIds.map(findItem).filter(Boolean);
        if (!items.length) {
            const empty = document.createElement('div');
            empty.className = 'storage-drawer-empty';
            empty.textContent = state.interaction === 'edit' ? '从下方选择物品，再点击这个标记点；桌面端也可以直接拖入。' : '这个位置目前没有物品';
            list.append(empty);
        }
        items.forEach(item => list.append(buildDrawerItem(item, marker)));
        body.append(list);
    }

    function buildMarkerEditor(marker) {
        const editor = document.createElement('div');
        editor.className = 'storage-marker-edit';
        const label = document.createElement('label');
        label.textContent = '位置名称';
        const row = document.createElement('div');
        row.className = 'storage-marker-edit-row';
        const input = document.createElement('input');
        input.className = 'storage-marker-name-input';
        input.value = marker.name;
        input.maxLength = 30;
        input.addEventListener('change', () => {
            marker.name = input.value.trim() || marker.name;
            currentRoom().updatedAt = Date.now();
            saveRooms(true);
            renderStorageRoom();
        });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'storage-icon-btn';
        remove.title = '删除这个位置';
        remove.textContent = '🗑️';
        remove.addEventListener('click', () => {
            if (!window.confirm(`删除位置「${marker.name}」？其中物品会回到待放置区。`)) return;
            const room = currentRoom();
            room.markers = room.markers.filter(item => item.id !== marker.id);
            room.updatedAt = Date.now();
            state.selectedMarkerId = null;
            saveRooms(true);
            renderStorageRoom();
            closeDrawer();
        });
        row.append(input, remove);
        editor.append(label, row);
        return editor;
    }

    function buildDrawerItem(item, marker) {
        const row = document.createElement('div');
        row.className = `storage-item-row${idString(item.id) === state.trackingItemId ? ' is-tracked-item' : ''}`;
        row.dataset.itemId = idString(item.id);
        row.append(itemVisual(item, 'storage-row-placeholder'));
        const text = document.createElement('div');
        const name = document.createElement('div');
        name.className = 'storage-item-row-name';
        name.textContent = item.name || '未命名物品';
        const meta = document.createElement('div');
        meta.className = 'storage-item-row-meta';
        meta.textContent = item.cat || '未分类';
        text.append(name, meta);
        text.addEventListener('click', () => openItemDetail(item));
        row.append(text);
        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'storage-icon-btn';
        if (state.interaction === 'edit') {
            action.title = '移回待放置区';
            action.textContent = '↩';
            action.addEventListener('click', () => unassignItem(item.id, marker.id));
        } else {
            action.title = '查看详情';
            action.textContent = '›';
            action.addEventListener('click', () => openItemDetail(item));
        }
        row.append(action);
        return row;
    }

    function renderTray() {
        const tray = $('#storageUnplacedTray');
        if (!tray) return;
        tray.replaceChildren();
        const placed = new Set(state.rooms.flatMap(room => room.markers.flatMap(marker => marker.itemIds.map(idString))));
        const allUnplaced = getInventory().filter(item => !placed.has(idString(item.id)));
        const visible = state.trayQuery
            ? allUnplaced.filter(item => `${item.name || ''} ${item.cat || ''} ${item.remark || ''}`.toLowerCase().includes(state.trayQuery))
            : allUnplaced;
        $('#storageTrayCount').textContent = `${allUnplaced.length}件`;
        $('#storageTrayHint').textContent = state.interaction === 'edit'
            ? '拖到标记点，或先点物品再点标记点'
            : '未关联到任何位置的物品';
        if (!visible.length) {
            const empty = document.createElement('div');
            empty.className = 'storage-tray-empty';
            empty.textContent = state.trayQuery ? '没有匹配的待放置物品' : (getInventory().length ? '所有物品都已安排位置 ✓' : '物品库还是空的');
            tray.append(empty);
            return;
        }
        const fragment = document.createDocumentFragment();
        visible.forEach(item => fragment.append(buildTrayCard(item)));
        tray.append(fragment);
    }

    function buildTrayCard(item) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = `storage-tray-card${idString(item.id) === state.selectedItemId ? ' selected' : ''}`;
        card.dataset.itemId = idString(item.id);
        card.draggable = state.interaction === 'edit';
        card.append(itemVisual(item, 'storage-card-placeholder'));
        const name = document.createElement('span');
        name.className = 'storage-tray-card-name';
        name.textContent = item.name || '未命名物品';
        card.append(name);
        card.addEventListener('click', () => {
            if (state.interaction !== 'edit') return openItemDetail(item);
            state.selectedItemId = state.selectedItemId === idString(item.id) ? null : idString(item.id);
            document.querySelectorAll('.storage-tray-card').forEach(button => button.classList.toggle('selected', button.dataset.itemId === state.selectedItemId));
            showToast(state.selectedItemId ? '已选中物品，现在点击一个标记点' : '已取消选择');
        });
        card.addEventListener('dragstart', event => {
            if (state.interaction !== 'edit') return event.preventDefault();
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', idString(item.id));
        });
        bindTouchItemDrag(card, item);
        return card;
    }

    function bindTouchItemDrag(card, item) {
        let timer = 0;
        let active = false;
        let ghost = null;
        let pointerId = null;
        const cleanup = () => {
            window.clearTimeout(timer);
            ghost?.remove();
            ghost = null;
            active = false;
            pointerId = null;
            document.querySelectorAll('.storage-marker.drag-over').forEach(marker => marker.classList.remove('drag-over'));
        };
        card.addEventListener('pointerdown', event => {
            if (event.pointerType === 'mouse' || state.interaction !== 'edit') return;
            pointerId = event.pointerId;
            timer = window.setTimeout(() => {
                active = true;
                card.setPointerCapture(pointerId);
                ghost = document.createElement('div');
                ghost.className = 'storage-drag-ghost';
                ghost.textContent = item.name || '未命名物品';
                document.body.append(ghost);
                ghost.style.left = `${event.clientX}px`;
                ghost.style.top = `${event.clientY}px`;
                if (navigator.vibrate) navigator.vibrate(18);
            }, 320);
        });
        card.addEventListener('pointermove', event => {
            if (event.pointerId !== pointerId) return;
            if (!active) return;
            event.preventDefault();
            ghost.style.left = `${event.clientX}px`;
            ghost.style.top = `${event.clientY}px`;
            const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.storage-marker');
            document.querySelectorAll('.storage-marker.drag-over').forEach(marker => marker.classList.toggle('drag-over', marker === target));
        });
        card.addEventListener('pointerup', event => {
            if (event.pointerId !== pointerId) return;
            window.clearTimeout(timer);
            if (active) {
                event.preventDefault();
                const marker = document.elementFromPoint(event.clientX, event.clientY)?.closest('.storage-marker');
                if (marker) assignItemToMarker(item.id, marker.dataset.markerId);
            }
            cleanup();
        });
        card.addEventListener('pointercancel', cleanup);
    }

    function itemVisual(item, placeholderClass) {
        if (item.img) {
            const image = document.createElement('img');
            image.src = item.img;
            image.alt = '';
            image.loading = 'lazy';
            image.decoding = 'async';
            image.draggable = false;
            return image;
        }
        const placeholder = document.createElement('div');
        placeholder.className = placeholderClass;
        placeholder.textContent = '📦';
        placeholder.style.display = 'grid';
        placeholder.style.placeItems = 'center';
        return placeholder;
    }

    function findItem(itemId) {
        const id = idString(itemId);
        return getInventory().find(item => idString(item.id) === id) || null;
    }

    function assignItemToMarker(itemId, markerId) {
        const room = currentRoom();
        const marker = room && room.markers.find(item => item.id === markerId);
        const item = findItem(itemId);
        if (!room || !marker || !item) return;
        state.rooms.forEach(storageRoom => storageRoom.markers.forEach(point => {
            point.itemIds = point.itemIds.filter(id => idString(id) !== idString(itemId));
        }));
        marker.itemIds.push(idString(itemId));
        room.updatedAt = Date.now();
        state.selectedMarkerId = marker.id;
        state.selectedItemId = null;
        saveRooms(true);
        renderStorageRoom();
        openDrawer();
        showToast(`已将「${item.name || '物品'}」放到「${marker.name}」`);
    }

    function unassignItem(itemId, markerId) {
        const room = currentRoom();
        const marker = room && room.markers.find(item => item.id === markerId);
        if (!marker) return;
        marker.itemIds = marker.itemIds.filter(id => idString(id) !== idString(itemId));
        room.updatedAt = Date.now();
        saveRooms(true);
        renderStorageRoom();
        openDrawer();
    }

    function openItemDetail(item) {
        if (typeof window.showDetail === 'function' && item.img) {
            window.showDetail(item.img, encodeURIComponent(item.remark || item.name || ''));
        } else {
            showToast(item.name || '未命名物品');
        }
    }

    function openDrawer() {
        $('#storageLocationDrawer')?.classList.add('open');
    }

    function closeDrawer() {
        $('#storageLocationDrawer')?.classList.remove('open');
    }

    function showToast(message) {
        const toast = $('#storageToast');
        if (!toast) return;
        window.clearTimeout(state.toastTimer);
        toast.textContent = message;
        toast.classList.add('show');
        state.toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2300);
    }

    function cleanDanglingItems() {
        const valid = new Set(getInventory().map(item => idString(item.id)));
        let changed = false;
        state.rooms.forEach(room => room.markers.forEach(marker => {
            const next = marker.itemIds.filter(id => valid.has(idString(id)));
            if (next.length !== marker.itemIds.length) changed = true;
            marker.itemIds = next;
        }));
        return changed;
    }

    function saveRooms(immediate = false) {
        window.clearTimeout(state.saveTimer);
        const write = async () => {
            try {
                await localforage.setItem(ROOM_KEY, state.rooms);
            } catch (error) {
                console.error('保存储物间失败', error);
                window.alert(`储物间保存失败：${error.message}`);
            }
        };
        if (immediate) return write();
        state.saveTimer = window.setTimeout(write, 180);
    }

    function getStorageRoomBackup() {
        return JSON.parse(JSON.stringify(state.rooms));
    }

    async function importStorageRoomBackup(rooms) {
        state.rooms = normalizeRooms(rooms);
        state.activeRoomId = state.rooms[0] ? state.rooms[0].id : null;
        state.selectedMarkerId = null;
        state.selectedItemId = null;
        cleanDanglingItems();
        await saveRooms(true);
        renderStorageRoom();
    }

    async function mergeStorageRoomBackup(rooms) {
        const incoming = normalizeRooms(rooms);
        const existingIds = new Set(state.rooms.map(room => room.id));
        incoming.forEach(room => {
            if (existingIds.has(room.id)) room.id = uid('room');
            state.rooms.push(room);
        });
        cleanDanglingItems();
        if (!state.activeRoomId && state.rooms[0]) state.activeRoomId = state.rooms[0].id;
        await saveRooms(true);
        renderStorageRoom();
    }

    function onInventoryUpdatedForStorageRoom() {
        if (!state.initialized) return;
        if (cleanDanglingItems()) saveRooms();
        state.dirty = true;
        if (!$('#storageRoomMode')?.hidden) renderStorageRoom();
    }

    function findItemLocation(itemId) {
        const targetId = idString(itemId);
        for (const room of state.rooms) {
            const marker = room.markers.find(point => point.itemIds.some(id => idString(id) === targetId));
            if (marker) return { room, marker };
        }
        return null;
    }

    function locateItemInStorageRoom(itemId) {
        const item = findItem(itemId);
        if (!item) return;
        const location = findItemLocation(itemId);
        window.clearTimeout(state.trackingTimer);
        state.trayQuery = '';
        if ($('#storageTraySearch')) $('#storageTraySearch').value = '';

        if (!location) {
            state.trayCollapsed = false;
            applyCollapseState(true);
            state.interaction = 'edit';
            state.selectedMarkerId = null;
            state.selectedItemId = idString(itemId);
            state.trackingMarkerId = null;
            state.trackingItemId = null;
            if (!state.activeRoomId && state.rooms[0]) state.activeRoomId = state.rooms[0].id;
            renderStorageRoom();
            setWorkspaceMode('storage');
            requestAnimationFrame(() => {
                const card = [...document.querySelectorAll('.storage-tray-card')].find(node => node.dataset.itemId === idString(itemId));
                card?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            });
            showToast(`「${item.name || '该物品'}」尚未设置位置，已在待放置区选中`);
            return;
        }

        state.activeRoomId = location.room.id;
        state.interaction = 'browse';
        state.selectedMarkerId = location.marker.id;
        state.selectedItemId = null;
        state.trackingMarkerId = location.marker.id;
        state.trackingItemId = idString(itemId);
        state.zoom = 1;
        renderStorageRoom();
        setWorkspaceMode('storage');
        openDrawer();
        requestAnimationFrame(() => {
            const target = [...document.querySelectorAll('.storage-marker-wrap')].find(node => node.dataset.markerId === location.marker.id);
            target?.classList.add('is-tracking');
            $('#storageSceneStage')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            target?.querySelector('.storage-marker')?.focus({ preventScroll: true });
        });
        showToast(`已定位：${location.room.name} › ${location.marker.name}`);
        state.trackingTimer = window.setTimeout(() => {
            document.querySelectorAll('.storage-marker-wrap.is-tracking').forEach(node => node.classList.remove('is-tracking'));
            document.querySelectorAll('.storage-item-row.is-tracked-item').forEach(node => node.classList.remove('is-tracked-item'));
            state.trackingMarkerId = null;
            state.trackingItemId = null;
        }, 12000);
    }

    window.initStorageRoomMode = initStorageRoomMode;
    window.getStorageRoomBackup = getStorageRoomBackup;
    window.importStorageRoomBackup = importStorageRoomBackup;
    window.mergeStorageRoomBackup = mergeStorageRoomBackup;
    window.onInventoryUpdatedForStorageRoom = onInventoryUpdatedForStorageRoom;
    window.locateItemInStorageRoom = locateItemInStorageRoom;
})();
