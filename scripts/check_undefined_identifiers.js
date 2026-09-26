#!/usr/bin/env node
// Usage: npm run check:undefined — lists identifiers used but never declared/imported,
// and styles.X references missing from the file's StyleSheet.create
// (would crash at runtime with ReferenceError; Metro bundling does not catch these).
const babel=require('@babel/core'); const traverse=require('@babel/traverse').default; const fs=require('fs');
const GLOBALS=new Set(['console','require','module','exports','process','global','globalThis','window','document','navigator','fetch','Promise','setTimeout','clearTimeout','setInterval','clearInterval','queueMicrotask','requestAnimationFrame','cancelAnimationFrame','JSON','Math','Date','Number','String','Boolean','Array','Object','Map','Set','WeakMap','WeakSet','Symbol','Error','TypeError','RangeError','RegExp','Intl','URL','URLSearchParams','encodeURIComponent','decodeURIComponent','parseInt','parseFloat','isNaN','isFinite','Infinity','NaN','undefined','arguments','Buffer','__DEV__','FormData','Blob','Headers','Response','Request','AbortController','TextEncoder','TextDecoder','atob','btoa','structuredClone','Uint8Array','ArrayBuffer','DataView','Reflect','Proxy','BigInt','performance','crypto','alert','XMLHttpRequest','WebSocket','Event','EventTarget','Function']);
let issues=0;
const { execSync } = require('child_process');
const files = process.argv.slice(2).length ? process.argv.slice(2)
  : execSync('git ls-files', { encoding: 'utf8' }).split('\n')
      .filter((f) => /\.js$/.test(f) && !/^(scripts|android|supabase)\//.test(f));
for (const f of files) {
  const src=fs.readFileSync(f,'utf8');
  let ast; try { ast=babel.parseSync(src,{filename:f,presets:[require.resolve('babel-preset-expo')],babelrc:false,configFile:false}); } catch(e){ console.log('PARSE',f,e.message.split('\n')[0]); issues++; continue; }
  // Styles: `const styles = StyleSheet.create({...})` → flag styles.foo where foo isn't defined
  // (React Native silently ignores undefined styles, so these never crash — they just vanish).
  const sheets = new Map();
  traverse(ast, { VariableDeclarator(p) {
    const init = p.node.init;
    if (p.node.id.type === 'Identifier' && init && init.type === 'CallExpression'
      && init.callee.type === 'MemberExpression' && init.callee.object.name === 'StyleSheet'
      && init.callee.property.name === 'create' && init.arguments[0]?.type === 'ObjectExpression') {
      const keys = init.arguments[0].properties.map((pr) => pr.key && (pr.key.name || pr.key.value));
      const seen = new Set();
      keys.forEach((k, idx) => {
        // A repeated key silently overrides the earlier style.
        if (seen.has(k)) { console.log(`${f}:${init.arguments[0].properties[idx].loc.start.line}  ${p.node.id.name}.${k} (duplicate style key — earlier one is overridden)`); issues++; }
        seen.add(k);
      });
      sheets.set(p.node.id.name, new Set(keys));
    }
  } });
  if (sheets.size) traverse(ast, { MemberExpression(p) {
    const { object, property, computed } = p.node;
    if (computed || object.type !== 'Identifier' || !sheets.has(object.name)) return;
    if (!sheets.get(object.name).has(property.name)) { console.log(`${f}:${p.node.loc.start.line}  ${object.name}.${property.name} (style not defined)`); issues++; }
  } });
  traverse(ast,{ ReferencedIdentifier(p){ const n=p.node.name; if (p.parentPath.isJSXMemberExpression()||p.isJSXIdentifier()&&/^[a-z]/.test(n)) return; if(!p.scope.hasBinding(n,true)&&!GLOBALS.has(n)){ console.log(`${f}:${p.node.loc.start.line}  ${n}`); issues++; } } });
}
console.log(issues? `${issues} undefined reference(s)` : 'no undefined references');
process.exitCode = issues ? 1 : 0;
