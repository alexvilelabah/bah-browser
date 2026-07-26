// Assinatura VMP (Widevine) — roda no hook afterSign, NÃO no afterPack.
//
// Por quê aqui: sem assinatura VMP a Netflix recusa com E100 (aceita o CDM, mas exige que
// o app venha assinado pelo serviço EVS da castLabs). E a assinatura só vale enquanto o
// binário não muda depois — medido: assinando no afterPack, o electron-builder ainda editava
// o Bah.exe 0,8s depois (ícone/versão), e a assinatura já saía inválida. O afterSign roda
// depois dessa edição, então é o último ponto seguro antes de montar o instalador.
//
// Vale só pro pacote: rodar `electron.exe <pasta>` (dev/.bat) NUNCA passa no DRM — é
// limitação do formato desempacotado, documentada pela castLabs, não erro do projeto.
//
// Requisitos: `pip install castlabs-evs` + conta grátis (`python -m castlabs_evs.account signup`).
// NÃO derruba o build se faltar: sem conta, sai instalador normal só que sem DRM — senão o
// CI de Linux/Mac e qualquer outro contribuidor quebrariam.
const { execFileSync } = require('child_process');

exports.default = async function afterSign(context) {
  const { appOutDir } = context;
  const py = process.platform === 'win32' ? 'python' : 'python3';
  try {
    execFileSync(py, ['-m', 'castlabs_evs.vmp', '-n', 'sign-pkg', appOutDir], { stdio: 'inherit' });
    // Confere de verdade em vez de confiar no código de saída: o passo acima já "teve
    // sucesso" uma vez com assinatura inválida no fim (ver acima), então validamos.
    execFileSync(py, ['-m', 'castlabs_evs.vmp', 'verify-pkg', appOutDir], { stdio: 'inherit' });
    console.log('[afterSign] VMP assinado e VERIFICADO — Netflix/Prime/Disney+ liberados.');
  } catch {
    console.warn('[afterSign] VMP não assinado — Netflix/Prime/Disney+ vão dar E100 neste build.');
    console.warn('            Habilitar: pip install castlabs-evs && python -m castlabs_evs.account signup');
  }
};
