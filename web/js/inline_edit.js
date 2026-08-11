// 就地编辑输入框生命周期共享模板（v0.9.71 屎山治理①）：
// 统一 4 处复制的 input/textarea 创建、事件 stopPropagation、Enter/Escape/blur 语义、done 标志 finish 闭包。
// 调用方只管：定位目标元素、state 编辑标志、commit 判断与 API；输入框的诞生到销毁全在这里。
//
// opts:
//   targetEl    Element   被输入框替换的元素（finish 时还原）
//   multiline   bool      true=textarea / false=input
//   className   string    输入框 class
//   value       string    初始值（仅用于塞入输入框，变化判断交给 onFinish）
//   shiftEnter  bool      多行时 Shift+Enter=换行（false 时 Enter 即提交）
//   onSetup     fn(input) 额外配置（autoResize 等），在 replaceWith 后调用
//   onFinish    fn(commit, raw) 收尾：commit=Enter/blur 提交，false=Escape；raw=trim 后的值。
//                         调用方在此做变化判断/commit API/renderGrid/清 state 标志。
//
// 返回 { finish, input } —— 外部需要强制收尾时可调 finish。
export function inlineEdit(opts) {
    const {
        targetEl, multiline = false, className = '', value = '',
        shiftEnter = false, onSetup = null, onFinish = null,
    } = opts;

    const input = document.createElement(multiline ? 'textarea' : 'input');
    input.className = className;
    input.value = value;
    input.draggable = false;
    if (multiline) {
        input.rows = 1;
        input.wrap = 'soft';
    }
    // 输入框内的事件一律不冒泡：拖选文字不触发卡片拖拽/框选/右键滑动
    ['mousedown', 'mousemove', 'mouseup', 'dragstart', 'selectstart', 'click', 'dblclick'].forEach(t => {
        input.addEventListener(t, (ev) => ev.stopPropagation());
    });
    targetEl.replaceWith(input);
    if (onSetup) onSetup(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (commit) => {
        if (done) return;
        done = true;
        const raw = input.value.trim();
        if (input.isConnected) input.replaceWith(targetEl);
        if (onFinish) onFinish(commit, raw);
    };
    input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && !(shiftEnter && ev.shiftKey)) { ev.preventDefault(); finish(true); }
        else if (ev.key === 'Escape') finish(false);
        ev.stopPropagation();
    });
    input.addEventListener('blur', () => finish(true));
    return { finish, input };
}
