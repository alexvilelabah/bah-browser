// "Baixe o <programa> pra este computador": perfil da máquina → dica do que escolher, e a checagem
// do arquivo que começou a baixar (SO, CPU, pacote), agregadores de download e parede de login.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  machineProfile, pickHint, machineLine, macosCodename, windowsName, linuxPackageType,
  classifyBuild, checkBuild, thirdPartyDownloadSite, thirdPartyNote, signInWall, isDownloadControl, installerFileOf,
} from '../../src/shared/software-download.ts';

const macIntel = machineProfile({ platform: 'darwin', arch: 'x64', osVersion: '15.6.1' });
const macArm = machineProfile({ platform: 'darwin', arch: 'arm64', osVersion: '26.0' });
const macRosetta = machineProfile({ platform: 'darwin', arch: 'x64', osVersion: '14.5', armTranslated: true });
const win11 = machineProfile({ platform: 'win32', arch: 'x64', osVersion: '10.0.22631' });
const win10 = machineProfile({ platform: 'win32', arch: 'x64', osVersion: '10.0.19045' });
const winArm = machineProfile({ platform: 'win32', arch: 'arm64', osVersion: '10.0.26100' });
const ubuntu = machineProfile({ platform: 'linux', arch: 'x64', osVersion: '6.8.0', linuxOsRelease: 'NAME="Ubuntu"\nID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 24.04 LTS"\n' });
const fedoraArm = machineProfile({ platform: 'linux', arch: 'arm64', linuxOsRelease: 'ID=fedora\nPRETTY_NAME="Fedora Linux 41"\n' });

test('OS names: macOS codename, Windows 10 vs 11 by build, Linux package type', () => {
  assert.strictEqual(macosCodename('15.6.1'), 'Sequoia');
  assert.strictEqual(macosCodename('26.0'), 'Tahoe');
  assert.strictEqual(macosCodename('10.15.7'), 'Catalina');
  assert.strictEqual(macosCodename('99'), '');
  assert.strictEqual(windowsName('10.0.22631'), 'Windows 11');
  assert.strictEqual(windowsName('10.0.19045'), 'Windows 10');
  assert.strictEqual(linuxPackageType('ID=linuxmint\nID_LIKE="ubuntu debian"'), 'deb');
  assert.strictEqual(linuxPackageType('ID="opensuse-tumbleweed"\nID_LIKE="opensuse suse"'), 'rpm');
  assert.strictEqual(linuxPackageType('ID=arch'), 'pacman');
  assert.strictEqual(linuxPackageType(''), '');
});

test('machine profile: OS + CPU labels across platforms', () => {
  assert.deepStrictEqual([macIntel.os, macIntel.arch, macIntel.osName, macIntel.archLabel], ['macos', 'x64', 'macOS 15.6.1 (Sequoia)', 'Intel (x86-64)']);
  assert.deepStrictEqual([macArm.arch, macArm.archLabel], ['arm64', 'Apple Silicon (arm64)']);
  // Build x64 no Rosetta: o hardware é Apple Silicon.
  assert.strictEqual(macRosetta.arch, 'arm64');
  assert.deepStrictEqual([win11.osName, win11.archLabel], ['Windows 11', 'x64 (64-bit Intel/AMD)']);
  assert.strictEqual(win10.osName, 'Windows 10');
  assert.deepStrictEqual([winArm.arch, winArm.archLabel], ['arm64', 'ARM64']);
  assert.deepStrictEqual([ubuntu.os, ubuntu.osName, ubuntu.linuxPkg], ['linux', 'Linux (Ubuntu 24.04 LTS)', 'deb']);
  assert.deepStrictEqual([fedoraArm.arch, fedoraArm.linuxPkg], ['arm64', 'rpm']);
  assert.strictEqual(machineProfile({ platform: 'win32', arch: 'ia32', osVersion: '10.0.19045' }).arch, 'x86');
});

test('pick hint says what to choose for this machine', () => {
  assert.match(pickHint(macIntel), /Intel.*x64.*Universal.*\.dmg or \.pkg/);
  assert.match(pickHint(macIntel), /NOT an "Apple Silicon".*arm64"-only/);
  assert.match(pickHint(macArm), /Apple Silicon.*arm64.*Universal/);
  assert.match(pickHint(win11), /Windows 64-bit \(x64\) installer \(\.exe or \.msi\)/);
  assert.match(pickHint(winArm), /ARM64 installer/);
  assert.match(pickHint(ubuntu), /x86_64\/amd64: a \.deb package/);
  assert.match(pickHint(fedoraArm), /arm64\/aarch64: an \.rpm package/);
  assert.match(machineLine(macIntel), /^THIS COMPUTER: macOS 15\.6\.1 \(Sequoia\) on Intel \(x86-64\)\. PICK: /);
});

test('classify a download by file name (extension, OS and CPU tokens)', () => {
  assert.deepStrictEqual(classifyBuild('Steam.dmg'), { os: 'macos', arch: '', pkg: 'dmg' });
  assert.deepStrictEqual(classifyBuild('SteamSetup.exe'), { os: 'windows', arch: '', pkg: 'exe' });
  assert.strictEqual(classifyBuild('Tool_arm64.dmg').arch, 'arm64');
  assert.strictEqual(classifyBuild('Tool-x86_64.dmg').arch, 'x64');
  assert.strictEqual(classifyBuild('Tool-universal.dmg').arch, 'universal');
  assert.strictEqual(classifyBuild('Tool-AppleSilicon.pkg').arch, 'arm64');
  assert.strictEqual(classifyBuild('Tool-Intel.pkg').arch, 'x64');
  assert.deepStrictEqual(classifyBuild('tool-1.2-darwin-arm64.tar.gz'), { os: 'macos', arch: 'arm64', pkg: 'tar.gz' });
  assert.deepStrictEqual(classifyBuild('tool-1.2-win-x64.zip'), { os: 'windows', arch: 'x64', pkg: 'zip' });
  assert.deepStrictEqual(classifyBuild('tool_1.2_amd64.deb'), { os: 'linux', arch: 'x64', pkg: 'deb' });
  assert.strictEqual(classifyBuild('setup-i686.exe').arch, 'x86');
  // "darwin" contém "win"; "IntelliJ" contém "intel": sem token solto, não confunde.
  assert.strictEqual(classifyBuild('app-darwin.zip').os, 'macos');
  assert.strictEqual(classifyBuild('IntelliJ.dmg').arch, '');
});

test('build check on an Intel Mac: right build OK, wrong OS / wrong CPU flagged', () => {
  assert.strictEqual(checkBuild('Steam.dmg', macIntel).level, '');
  assert.strictEqual(checkBuild('Photoshop_Universal.dmg', macIntel).level, '');
  assert.strictEqual(checkBuild('HP_Easy_Start.app.zip', macIntel).level, '');
  const exe = checkBuild('SteamSetup.exe', macIntel);
  assert.strictEqual(exe.level, 'error');
  assert.match(exe.note, /WRONG OS: SteamSetup\.exe is a Windows installer but the user's computer is macOS/);
  const arm = checkBuild('Tool_arm64.dmg', macIntel);
  assert.strictEqual(arm.level, 'error');
  assert.match(arm.note, /WRONG CPU: .*this computer is Intel \(x86-64\).*Intel \/ x64 or Universal/);
  assert.strictEqual(checkBuild('Tool-x64.dmg', macIntel).level, '');
  assert.strictEqual(checkBuild('readme.pdf', macIntel).level, '');
});

test('build check elsewhere: Rosetta/emulation is a warning, wrong package type is an error', () => {
  assert.strictEqual(checkBuild('Tool-Intel.dmg', macArm).level, 'warn');
  assert.strictEqual(checkBuild('Tool-arm64.dmg', macArm).level, '');
  assert.strictEqual(checkBuild('Steam.dmg', win11).level, 'error');
  assert.strictEqual(checkBuild('SteamSetup.exe', win11).level, '');
  assert.strictEqual(checkBuild('setup-arm64.exe', win11).level, 'error');
  assert.strictEqual(checkBuild('setup-x86.exe', win11).level, 'warn');
  assert.strictEqual(checkBuild('setup-x64.msi', winArm).level, 'warn');
  assert.strictEqual(checkBuild('tool_amd64.deb', ubuntu).level, '');
  assert.match(checkBuild('tool.x86_64.rpm', ubuntu).note, /WRONG PACKAGE: .*\.rpm.*\.deb/);
  assert.strictEqual(checkBuild('tool_arm64.deb', ubuntu).level, 'error');
  assert.strictEqual(checkBuild('tool.AppImage', fedoraArm).level, '');
});

test('download controls: vendor wording ("Install Steam", "Get the app", "Try free") counts; store/extension installs do not', () => {
  const dmg = 'https://cdn.akamai.steamstatic.com/client/installer/steam.dmg';
  // Fortes: valem com ou sem link (menos loja).
  for (const l of ['Download', 'Download now', 'Free download', 'Download for Mac', 'Download Steam for Windows', 'Agree to the EULA and Download', 'Baixar', 'Descargar ahora'])
    assert.ok(isDownloadControl(l, 'https://vendor.example/download/page'), l);
  // Fracos com link pra instalador ou botão sem link: valem.
  for (const l of ['Install Steam', 'Install', 'Install now', 'Get', 'Get the app', 'Get it now', 'Try free', 'Try it free', 'Free trial'])
    assert.ok(isDownloadControl(l, dmg), `${l} → .dmg`);
  assert.ok(isDownloadControl('Install Steam', ''));
  assert.ok(isDownloadControl('Get the app', 'javascript:void(0)'));
  assert.ok(isDownloadControl('  Install   Steam  ', 'https://x.example/SteamSetup.exe?v=2'));
  // Fracos que levam a uma PÁGINA (menu "Install Steam" → /about) ou a uma loja/extensão: não.
  assert.ok(!isDownloadControl('Install Steam', 'https://store.steampowered.com/about/'));
  assert.ok(!isDownloadControl('Get', 'https://vendor.example/pricing'));
  assert.ok(!isDownloadControl('Install', 'https://chromewebstore.google.com/detail/abc'));
  assert.ok(!isDownloadControl('Get', 'https://apps.apple.com/us/app/steam-link/id123'));
  assert.ok(!isDownloadControl('Download', 'https://apps.apple.com/us/app/x/id1'));
  assert.ok(!isDownloadControl('Get it now', 'ms-windows-store://pdp/?productid=9NBLGGH4R32N'));
  assert.ok(!isDownloadControl('Install', 'https://addons.mozilla.org/firefox/addon/x/'));
  assert.ok(!isDownloadControl('Play now', dmg));
  assert.ok(!isDownloadControl('Sign in', ''));
  assert.strictEqual(installerFileOf(dmg), 'steam.dmg');
  assert.strictEqual(installerFileOf('https://x.example/HP_Easy_Start.app.zip?model=1'), 'HP_Easy_Start.app.zip');
  assert.strictEqual(installerFileOf('https://x.example/about/'), '');
  assert.strictEqual(installerFileOf('/files/Steam.dmg'), 'Steam.dmg');
  assert.ok(isDownloadControl('Install Steam', '/files/SteamSetup.exe'));
  assert.ok(!isDownloadControl('Install Steam', '/about/'));
});

test('third-party "free download" sites are flagged; vendor sites are not', () => {
  assert.strictEqual(thirdPartyDownloadSite('https://en.softonic.com/download/steam/windows'), 'softonic.com');
  assert.strictEqual(thirdPartyDownloadSite('https://filehippo.com/download_steam/'), 'filehippo.com');
  assert.strictEqual(thirdPartyDownloadSite('https://steam.en.uptodown.com/mac'), 'uptodown.com');
  assert.strictEqual(thirdPartyDownloadSite('https://download.cnet.com/steam/'), 'download.cnet.com');
  assert.strictEqual(thirdPartyDownloadSite('https://www.techspot.com/downloads/7210-steam.html'), 'techspot.com');
  assert.strictEqual(thirdPartyDownloadSite('https://www.techspot.com/news/'), '');
  assert.strictEqual(thirdPartyDownloadSite('https://store.steampowered.com/about/'), '');
  assert.strictEqual(thirdPartyDownloadSite('https://support.hp.com/us-en/drivers'), '');
  assert.strictEqual(thirdPartyDownloadSite('not a url'), '');
  assert.match(thirdPartyNote('softonic.com'), /THIRD-PARTY DOWNLOAD SITE: softonic\.com.*OFFICIAL site/);
  assert.strictEqual(thirdPartyNote(''), '');
});

test('sign-in walls: password field, auth host/path, "sign in to download" — not a header Sign in link', () => {
  assert.ok(signInWall({ url: 'https://vendor.example/download', elements: [{ tag: 'input', type: 'password' }] }));
  assert.ok(signInWall({ url: 'https://login.microsoftonline.com/common/oauth2/authorize' }));
  assert.ok(signInWall({ url: 'https://auth.services.adobe.com/en_US/index.html' }));
  assert.ok(signInWall({ url: 'https://www.altium.com/signin?next=/downloads' }));
  assert.ok(signInWall({ url: 'https://vendor.example/register' }));
  assert.ok(signInWall({ url: 'https://vendor.example/dl', text: 'Please sign in to download SolidWorks.' }));
  assert.ok(signInWall({ url: 'https://vendor.example/dl', text: 'You need a 3DEXPERIENCE ID to get the installer.' }));
  assert.ok(signInWall({ url: 'https://vendor.example/dl', text: 'Create a free account to download the trial.' }));
  assert.strictEqual(signInWall({ url: 'https://store.steampowered.com/about/', text: 'Sign in  Install Steam  Download for Mac', elements: [{ tag: 'a', text: 'Sign in' }] }), '');
  assert.strictEqual(signInWall({ url: 'https://support.hp.com/us-en/drivers/printers', text: 'Sign in to see your products. Let HP find my products' }), '');
  assert.strictEqual(signInWall({ url: 'https://www.adobe.com/products/photoshop.html', text: 'Free trial. Buy now. Sign in' }), '');
});
