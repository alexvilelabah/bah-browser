// Hook de pós-empacotamento do electron-builder: flipa os Electron Fuses SEGUROS
// no binário gerado, blindando a distribuição. Subconjunto conservador — só desliga
// vetores de abuso (usar o .exe como Node genérico / injeção via env/CLI). NÃO mexe
// em integridade do ASAR nem criptografia de cookie (esses podem quebrar o app/login).
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const path = require('path');

exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const ext = electronPlatformName === 'win32' ? '.exe' : (electronPlatformName === 'darwin' ? '.app' : '');
  // No Linux o binário sai em MINÚSCULO (convenção do electron-builder: "bah", não "Bah"),
  // então productFilename não serve lá — usa o executableName real e cai pro lowercase.
  const exeName = electronPlatformName === 'linux'
    ? (packager.executableName || packager.appInfo.productFilename.toLowerCase())
    : packager.appInfo.productFilename; // "Bah"
  const electronBinary = path.join(appOutDir, `${exeName}${ext}`);
  try {
    await flipFuses(electronBinary, {
      version: FuseVersion.V1,
      resetAdHocDarwinSignature: electronPlatformName === 'darwin',
      [FuseV1Options.RunAsNode]: false,                              // não roda como Node genérico
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,   // ignora NODE_OPTIONS
      [FuseV1Options.EnableNodeCliInspectArguments]: false,          // ignora --inspect
    });
    console.log('[afterPack] Electron Fuses seguros aplicados em', electronBinary);
  } catch (e) {
    console.error('[afterPack] Falha ao aplicar fuses:', e);
    throw e;
  }
};
