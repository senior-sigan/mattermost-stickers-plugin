import React, {useEffect, useRef, useState} from 'react';

const batchSize = 40;

export default function StickerGrid({stickers, loading, busy, endpoint, onSend}) {
    const viewport = useRef(null);
    const more = useRef(null);
    const [visible, setVisible] = useState(batchSize);
    const hasMore = visible < stickers.length;
    const reveal = () => setVisible((count) => Math.min(count + batchSize, stickers.length));

    useEffect(() => {
        if (loading || busy || !hasMore || !more.current || !window.IntersectionObserver) { return; }
        let active = true;
        const observer = new IntersectionObserver((entries) => {
            if (active && entries.some((entry) => entry.isIntersecting)) {
                active = false;
                observer.disconnect();
                reveal();
            }
        }, {root: viewport.current, rootMargin: '160px 0px'});
        observer.observe(more.current);
        return () => { active = false; observer.disconnect(); };
    }, [visible, stickers.length, loading, busy, hasMore]);

    return <div ref={viewport} className='mm-stickers-grid' tabIndex={0} aria-label='Каталог стикеров'>
        {loading ? <p className='mm-stickers-empty'>Загрузка…</p> : stickers.slice(0, visible).map((sticker) =>
            <button type='button' className='mm-stickers-tile' key={sticker.id} disabled={busy}
                title={`${sticker.pack} · ${sticker.name}`} aria-label={`Отправить ${sticker.name}`} onClick={() => onSend(sticker)}>
                <img src={`${endpoint}/image/${sticker.id}`} alt={sticker.name} loading='lazy' decoding='async' draggable={false}/>
            </button>)}
        {!loading && !stickers.length && <p className='mm-stickers-empty'>Стикеров пока нет. Обратитесь к администратору.</p>}
        {!loading && hasMore && <button ref={more} type='button' className='mm-stickers-more' disabled={busy} onClick={reveal}>Ещё стикеры</button>}
    </div>;
}
