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
    // ATENÇÃO: este conjunto é EXATO, não é escolha nossa — é o único que o serviço de
    // assinatura VMP da castLabs aceita (ECS 35+). Qualquer fuse a mais/a menos e a
    // assinatura é recusada ("Binary signature denied"), o que derruba o DRM/Netflix.
    // Por isso agora ligamos também criptografia de cookie e integridade do ASAR, que
    // antes ficavam de fora por medo de quebrar login/app — os dois são, em si, ganho
    // de segurança. Testado: com este conjunto o EVS assina e o app abre normal.
    await flipFuses(electronBinary, {
      version: FuseVersion.V1,
      resetAdHocDarwinSignature: electronPlatformName === 'darwin',
      [FuseV1Options.RunAsNode]: false,                                  // não roda como Node genérico
      [FuseV1Options.EnableCookieEncryption]: true,                      // cookies cifrados em disco
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,       // ignora NODE_OPTIONS
      [FuseV1Options.EnableNodeCliInspectArguments]: false,              // ignora --inspect
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,       // app.asar não pode ser adulterado
      [FuseV1Options.OnlyLoadAppFromAsar]: true,                         // só carrega do asar
      [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
    });
    console.log('[afterPack] Electron Fuses seguros aplicados em', electronBinary);
  } catch (e) {
    console.error('[afterPack] Falha ao aplicar fuses:', e);
    throw e;
  }

  // A assinatura VMP (Widevine/Netflix) NÃO fica aqui: o electron-builder ainda edita o
  // .exe depois deste hook, o que invalidaria a assinatura. Ela roda em build/afterSign.js.
};
