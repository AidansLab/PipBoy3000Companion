const fs = require('fs');
const b = fs.readFileSync('build/icon.ico');
const count = b.readUInt16LE(4);
console.log('Images:', count);
for(let i=0; i<count; i++) {
  const w = b.readUInt8(6 + i*16);
  const h = b.readUInt8(6 + i*16 + 1);
  console.log('Size:', w === 0 ? 256 : w, 'x', h === 0 ? 256 : h);
}
