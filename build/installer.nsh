; Inclusao do instalador NSIS (o electron-builder pega build/installer.nsh sozinho).
; So a DESINSTALACAO muda: apaga o registro de "navegador padrao" que o proprio Bah grava em HKCU
; quando a pessoa clica em Menu > Navegador padrao > Tornar o Bah padrao (src/main/default-browser-rules.ts:
; UNINSTALL_KEYS / UNINSTALL_VALUES - o teste tests/unit/default-browser.test.ts confere que bate).
; Na ATUALIZACAO o instalador tambem roda o desinstalador da versao velha (com --updated): ai nao
; apaga nada, senao todo update tiraria o Bah de navegador padrao.
; Arquivo so em ASCII de proposito: o NSIS le include sem BOM na pagina de codigo do Windows.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Clients\StartMenuInternet\Bah"
    DeleteRegValue HKCU "Software\RegisteredApplications" "Bah"
    DeleteRegKey HKCU "Software\Classes\BahURL"
    DeleteRegKey HKCU "Software\Classes\BahHTML"
  ${endIf}
!macroend
