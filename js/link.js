/* =====================================================================================================
   LINK — how the main page (index.html) and the tool pages talk to each other
   Uses a BroadcastChannel named "ncdrive": every NC Drive page open in the same browser, from the same folder,
   hears every message. Nothing leaves the computer.
     NCLink.request(type, data, ms) → Promise with the main page's answer (rejects if nobody answers in ms)
     NCLink.handle(type, fn)        → the main page answers requests of that type with fn(data)
     NCLink.notify(type, data)      → tell every other page something happened
     NCLink.on(type, fn)            → listen for a notice
   Requests the main page answers:  state · loadFiles · setQuantities · setJob · jobNc   (see main-tools.js)
   Notices: changed (main's parts / nest / job changed) · bye (main closed) · log (a tool's log line for the
            main log) · roots-changed (linked folders) · drive-changed (target drive)
   Debugging: in the console, NCLink.debug = true prints every message this page sends and receives.
   ===================================================================================================== */
const NCLink = (() => {
  const bc = typeof BroadcastChannel === 'function' ? new BroadcastChannel('ncdrive') : null;
  const me = Math.random().toString(36).slice(2), pending = new Map(), handlers = {}, listeners = {};
  let seq = 0;
  const api = {
    available: !!bc,
    debug: false,
    handle(type, fn) { handlers[type] = fn; },
    on(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    notify(type, data) { send({ type, data, from: me }); },
    request(type, data, ms) {
      if (!bc) return Promise.reject(new Error('This browser cannot link pages.'));
      const id = me + ':' + ++seq;
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => { pending.delete(id); reject(new Error('NC Drive is not open')); }, ms || 1500);
        pending.set(id, m => { clearTimeout(t); m.error ? reject(new Error(m.error)) : resolve(m.data); });
        send({ type, data, req: id, from: me });
      });
    },
  };
  function send(m) {
    if (!bc) return;
    if (api.debug) console.log('NCLink →', m.type || 'reply', m);
    bc.postMessage(m);
  }
  if (bc)
    bc.onmessage = async e => {
      const m = e.data || {};
      if (api.debug) console.log('NCLink ←', m.type || 'reply', m);
      if (m.reply) { const done = m.to === me && pending.get(m.reply); if (done) { pending.delete(m.reply); done(m); } return; }
      if (m.req) {
        if (!handlers[m.type]) return; // only the main page answers requests
        let data, error = null;
        try { data = await handlers[m.type](m.data); } catch (err) { error = String((err && err.message) || err); }
        send({ reply: m.req, to: m.from, data, error });
        return;
      }
      (listeners[m.type] || []).forEach(fn => fn(m.data));
    };
  return api;
})();
