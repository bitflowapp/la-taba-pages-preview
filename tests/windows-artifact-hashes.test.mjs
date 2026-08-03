import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { selectWindowsArtifacts } from '../scripts/hash-windows-artifacts.mjs';

test('inventario Windows sólo selecciona EXE de aplicación, MSI, NSIS y firmas updater', () => {
  const root = path.resolve('fixture-release');
  const files = [
    path.join(root, 'taba-negocio.exe'),
    path.join(root, 'deps', 'build-helper.exe'),
    path.join(root, 'bundle', 'msi', 'TABA.msi'),
    path.join(root, 'bundle', 'msi', 'TABA.msi.sig'),
    path.join(root, 'bundle', 'nsis', 'TABA-setup.exe'),
    path.join(root, 'bundle', 'nsis', 'TABA-setup.exe.sig'),
  ];
  assert.deepEqual(
    selectWindowsArtifacts(root, files).map((file) => path.relative(root, file).replaceAll('\\', '/')),
    ['bundle/msi/TABA.msi', 'bundle/msi/TABA.msi.sig', 'bundle/nsis/TABA-setup.exe', 'bundle/nsis/TABA-setup.exe.sig', 'taba-negocio.exe'],
  );
});
