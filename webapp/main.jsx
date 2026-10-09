import React, {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {editorContext, pluginID, request, sendSticker, siteBase, stickerPostType} from './api.mjs';
import StickerPost from './sticker_post.jsx';
import AdminStickers from './admin_stickers.jsx';
import css from './style.css';

const openEvent = `${pluginID}:open`;
const icon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M20 13V6a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h6m8-8-8 8m8-8h-5a3 3 0 0 0-3 3v5"/><path d="M7 9h.01M14 9h.01M7 13c1 2 4 2 5 1"/></svg>';

function Picker({target, store, onClose}) {
    const base = siteBase(store);
    const endpoint = `${base}/plugins/${pluginID}`;
    const [stickers, setStickers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [status, setStatus] = useState('');
    const panel = useRef(null);
    const pendingFile = useRef({});
    const lock = useRef(false);
    const [position, setPosition] = useState({left: 8, top: 8, maxHeight: 420});

    async function reload(signal) {
        const result = await (await request(`${endpoint}/stickers`, {signal})).json();
        setStickers(result);
    }

    useEffect(() => {
        const controller = new AbortController();
        reload(controller.signal).catch((err) => { if (err.name !== 'AbortError') { setError(err.message); } }).finally(() => setLoading(false));
        return () => controller.abort();
    }, []);

    useEffect(() => {
        function positionPanel() {
            const rect = target.anchor.getBoundingClientRect();
            const height = Math.min(420, window.innerHeight - 16);
            const width = Math.min(360, window.innerWidth - 16);
            setPosition({left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top: Math.max(8, Math.min(rect.top - height - 8, window.innerHeight - height - 8)), maxHeight: height});
        }
        positionPanel();
        panel.current?.querySelector('button')?.focus();
        function keydown(event) {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!lock.current) { onClose(); } }
            if (event.key === 'Tab') {
                const buttons = [...panel.current.querySelectorAll('button:not(:disabled), [tabindex="0"]')];
                const first = buttons[0]; const last = buttons.at(-1);
                if (event.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && (document.activeElement === last || !panel.current.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
            }
        }
        function outside(event) { if (!lock.current && !panel.current?.contains(event.target) && !target.anchor.contains(event.target)) { onClose(); } }
        document.addEventListener('keydown', keydown, true);
        document.addEventListener('pointerdown', outside);
        window.addEventListener('resize', positionPanel);
        window.addEventListener('scroll', positionPanel, true);
        return () => {
            document.removeEventListener('keydown', keydown, true);
            document.removeEventListener('pointerdown', outside);
            window.removeEventListener('resize', positionPanel);
            window.removeEventListener('scroll', positionPanel, true);
            if (target.anchor.isConnected) { target.anchor.focus(); }
        };
    }, []);

    async function send(sticker) {
        if (lock.current) { return; }
        const current = target.resolve();
        if (!current || current.channelId !== target.context.channelId || current.rootId !== target.context.rootId) { setError('Канал или тред изменился. Откройте стикеры заново.'); return; }
        lock.current = true; setBusy(true); setError(''); setStatus('Отправка…');
        try {
            await sendSticker(base, sticker, target.context, store.getState().entities.users.currentUserId, pendingFile.current);
            onClose();
        } catch (err) { setError(`${err.message}. Если связь прервалась, проверьте чат перед повторной отправкой.`); }
        finally { lock.current = false; setBusy(false); setStatus(''); }
    }

    return createPortal(<section ref={panel} className='mm-stickers-panel' style={position} role='dialog' aria-modal='true' aria-label='Стикеры' aria-busy={busy}>
        <header><strong>Стикеры</strong><span className='mm-stickers-count'>{stickers.length || ''}</span>
            <button type='button' disabled={busy} className='mm-stickers-icon' title='Закрыть' aria-label='Закрыть' onClick={onClose}>×</button>
        </header>
        {error && <div className='mm-stickers-error' role='alert'>{error}</div>}
        <div className='mm-stickers-grid' tabIndex={0} aria-label='Каталог стикеров'>
            {loading ? <p className='mm-stickers-empty'>Загрузка…</p> : stickers.map((sticker) => <button type='button' className='mm-stickers-tile' key={sticker.id} disabled={busy} title={`${sticker.pack} · ${sticker.name}`} aria-label={`Отправить ${sticker.name}`} onClick={() => send(sticker)}>
                <img src={`${endpoint}/image/${sticker.id}`} alt={sticker.name} loading='lazy' draggable={false}/>
            </button>)}
            {!loading && !stickers.length && <p className='mm-stickers-empty'>Стикеров пока нет. Обратитесь к администратору.</p>}
        </div>
        <footer role='status'>{status || 'Нажмите на стикер, чтобы отправить'}</footer>
    </section>, document.body);
}

export function Root({store}) {
    const [target, setTarget] = useState(null);
    useEffect(() => {
        const buttons = new Map();
        let frame;
        function scan() {
            for (const [emoji, button] of buttons) {
                if (!emoji.isConnected || !button.isConnected) { button.remove(); buttons.delete(emoji); }
            }
            document.querySelectorAll('[id="emojiPickerButton"]').forEach((emoji) => {
                const textbox = emoji.closest('form')?.querySelector('textarea');
                if (!textbox || !editorContext(textbox, store.getState())) { buttons.get(emoji)?.remove(); buttons.delete(emoji); return; }
                let button = buttons.get(emoji);
                if (!button) {
                    button = document.createElement('button');
                    button.type = 'button'; button.className = 'mm-stickers-toolbar';
                    button.setAttribute('aria-label', 'Выбрать стикер'); button.title = 'Стикеры'; button.innerHTML = icon;
                    button.onclick = () => {
                        const resolve = () => textbox.isConnected ? editorContext(textbox, store.getState()) : null;
                        const context = resolve();
                        if (context) { setTarget((old) => old?.anchor === button ? null : {anchor: button, context, resolve}); }
                    };
                    emoji.insertAdjacentElement('afterend', button); buttons.set(emoji, button);
                }
                const disabled = emoji.disabled || textbox.disabled;
                if (button.disabled !== disabled) { button.disabled = disabled; }
            });
        }
        const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(scan); };
        const observer = new MutationObserver(schedule);
        observer.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['disabled']});
        const unsubscribe = store.subscribe(schedule);
        const open = (event) => setTarget(event.detail);
        window.addEventListener(openEvent, open); scan();
        return () => { cancelAnimationFrame(frame); observer.disconnect(); unsubscribe(); window.removeEventListener(openEvent, open); buttons.forEach((button) => button.remove()); };
    }, [store]);
    return target ? <Picker key={`${target.context.channelId}:${target.context.rootId}`} target={target} store={store} onClose={() => setTarget(null)}/> : null;
}

function EditorAction({draft}) {
    const latest = useRef(draft); latest.current = draft;
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    if (!draft?.channelId) { return null; }
    return <button type='button' className='mm-stickers-toolbar' title='Стикеры' aria-label='Открыть стикеры' onClick={(event) => {
        const anchor = event.currentTarget;
        if (anchor.closest('form')?.querySelector('#edit_textbox')) { return; }
        const resolve = () => mounted.current && anchor.isConnected ? {channelId: latest.current.channelId, rootId: latest.current.rootId || ''} : null;
        window.dispatchEvent(new CustomEvent(openEvent, {detail: {anchor: event.currentTarget, context: resolve(), resolve}}));
    }} dangerouslySetInnerHTML={{__html: icon}}/>;
}

class StickersPlugin {
    initialize(registry, store) {
        this.style = document.createElement('style'); this.style.textContent = css; document.head.appendChild(this.style);
        registry.registerRootComponent(() => <Root store={store}/>);
        registry.registerPostEditorActionComponent(EditorAction);
        registry.registerAdminConsoleCustomSetting('StickerLibrary', (props) => <AdminStickers {...props} base={siteBase(store)}/>, {showTitle: true});
        registry.registerPostTypeComponent(stickerPostType, (props) => <StickerPost {...props} base={siteBase(store)}/>);
    }
    uninitialize() { this.style?.remove(); }
}
window.registerPlugin(pluginID, new StickersPlugin());
