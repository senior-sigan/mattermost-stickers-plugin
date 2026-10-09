import React, {useEffect, useRef, useState} from 'react';
import {pluginID, request} from './api.mjs';

export default function AdminStickers({base, disabled = false}) {
    const endpoint = `${base}/plugins/${pluginID}/stickers`;
    const input = useRef(null);
    const lock = useRef(false);
    const [busy, setBusy] = useState(false);
    const [count, setCount] = useState(null);
    const [error, setError] = useState('');
    const [status, setStatus] = useState('');

    async function reload(signal) {
        const stickers = await (await request(endpoint, {signal})).json();
        setCount(stickers.length);
    }
    useEffect(() => {
        const abort = new AbortController();
        reload(abort.signal).catch((err) => {if (err.name !== 'AbortError') {setError(err.message);}});
        return () => abort.abort();
    }, [endpoint]);

    async function upload(event) {
        const files = [...event.target.files];
        event.target.value = '';
        if (!files.length || disabled || lock.current) { return; }
        lock.current = true; setBusy(true); setError('');
        let added = 0;
        try {
            for (const file of files) {
                setStatus(`Загрузка ${added + 1} / ${files.length}…`);
                if (!/\.png$/i.test(file.name) || file.size > 512 * 1024) { throw new Error(`${file.name}: нужен PNG до 512 КиБ`); }
                await request(endpoint, {method: 'POST', headers: {'Content-Type': 'image/png', 'X-Sticker-Name': encodeURIComponent(file.name)}, body: file});
                added++;
            }
            setStatus(`Обработано файлов: ${added}. Стикеры доступны в общем каталоге.`);
        } catch (err) {
            setStatus(''); setError(`Обработано: ${added} из ${files.length}. ${err.message}`);
        } finally {
            try { await reload(); } catch (err) { setError(err.message); }
            lock.current = false; setBusy(false);
        }
    }

    return <div className='mm-stickers-admin' aria-busy={busy}>
        <p>{count === null ? 'Загрузка каталога…' : `Стикеров в каталоге: ${count}`}</p>
        <button className='btn btn-primary' type='button' disabled={disabled || busy} onClick={() => input.current.click()}>Добавить PNG</button>
        <input ref={input} aria-label='Файлы стикеров' type='file' accept='.png,image/png' multiple hidden disabled={disabled || busy} onChange={upload}/>
        <p className='help-text'>PNG до 512 КиБ и 2048×2048 px. Изображения уменьшаются до 192 px. Добавляются сразу — нажимать «Сохранить» не требуется.</p>
        {status && <p role='status'>{status}</p>}
        {error && <p className='mm-stickers-error' role='alert'>{error}</p>}
    </div>;
}
