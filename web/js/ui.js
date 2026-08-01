// 轻提示 + 页内确认条（不依赖其它模块）

let toastTimer = null;

export function toast(msg, isError) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast' + (isError ? ' error' : '');
    t.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.display = 'none'; }, 2600);
}

export function askConfirm(text) {
    return new Promise((resolve) => {
        const bar = document.getElementById('confirmBar');
        document.getElementById('confirmText').textContent = text;
        bar.style.display = 'flex';
        const yes = document.getElementById('confirmYes');
        const no = document.getElementById('confirmNo');
        const cleanup = (val) => {
            bar.style.display = 'none';
            yes.onclick = no.onclick = null;
            resolve(val);
        };
        yes.onclick = () => cleanup(true);
        no.onclick = () => cleanup(false);
    });
}
