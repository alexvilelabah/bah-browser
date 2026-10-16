// Ícone 16px de um site — o MESMO em todo lugar (barra de favoritos, "»", ⋮ → Favoritos,
// autocomplete). Sem ícone: quadradinho colorido com a 1ª letra do site (sempre a mesma cor).
// Enquanto busca: espaço vazio do mesmo tamanho (nada pula de lugar quando o ícone chega).
import { useSiteIcon, markIconBroken } from '../favicons';
import { letterTile } from '../../shared/favicons';

// peek: só mostra se já estiver no cache (autocomplete — ver favicons.ts).
export default function SiteIcon({ url, title, peek }: { url: string; title?: string; peek?: boolean }) {
  const icon = useSiteIcon(url, peek);
  if (icon === undefined) return <span className="site-ic" aria-hidden="true" />;
  if (icon) {
    return (
      <img
        className="site-ic"
        src={icon}
        alt=""
        draggable={false}
        onError={() => markIconBroken(url)}
      />
    );
  }
  const tile = letterTile(url, title);
  return <span className="site-ic site-ic-tile" style={{ background: tile.color }} aria-hidden="true">{tile.letter}</span>;
}
