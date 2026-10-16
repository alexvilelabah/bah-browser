// Página da aba anônima recém-aberta (a "Você está navegando como anônimo" do Chrome), desenhada
// pelo próprio Bah por cima da <webview> em branco — nada é buscado na internet. Some sozinha
// quando a aba abre um site (digitar na barra de endereço pesquisa no mecanismo escolhido).
import React from 'react';
import { t } from '../i18n';
import IncognitoIcon from './IncognitoIcon';

export default function IncognitoPage() {
  return (
    <div className="incog-page" role="region" aria-label={t('incog.title')}>
      <div className="incog-box">
        <IncognitoIcon size={56} className="incog-hero" />
        <h1 className="incog-title">{t('incog.title')}</h1>
        <p className="incog-lead">{t('incog.lead')}</p>
        <div className="incog-cols">
          <div className="incog-col">
            <div className="incog-col-title">{t('incog.notSavedTitle')}</div>
            <ul>
              <li>{t('incog.notSaved1')}</li>
              <li>{t('incog.notSaved2')}</li>
              <li>{t('incog.notSaved3')}</li>
              <li>{t('incog.notSaved4')}</li>
            </ul>
          </div>
          <div className="incog-col">
            <div className="incog-col-title">{t('incog.visibleTitle')}</div>
            <ul>
              <li>{t('incog.visible1')}</li>
              <li>{t('incog.visible2')}</li>
              <li>{t('incog.visible3')}</li>
            </ul>
          </div>
        </div>
        <p className="incog-note">{t('incog.note')}</p>
      </div>
    </div>
  );
}
