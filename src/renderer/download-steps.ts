// Download é o último passo do pedido, ou o pedido continua depois dele? Decide se a tarefa acaba quando
// o download COMEÇA (o progresso fica no botão de downloads) ou se o Bah espera todos terminarem antes do
// próximo passo (encadeado: "baixe e instale", "baixe os dois e compare").

/** O pedido continua DEPOIS do download ("e instale", "depois resuma", "then compare"). */
export function commandHasFollowUp(command: string): boolean {
  return /\b(then|and then|after(wards)?|once (it|its|it's|they)|next)\b|\band (open|install|run|launch|unzip|extract|attach|upload|send|email|move|copy|rename|compare|read|summari[sz]e|play|watch|print|import|convert|share|post)\b|\b(install|unzip|extract|attach|upload|summari[sz]e|compare|convert|import|print)\b|\b(depois|em seguida|e (abra|instale|execute|descompacte|extraia|anexe|envie|mande|compare|resuma|leia|toque|imprima))\b|\b(instale|instalar|instalem|instale-o|instala-o|inst[aá]lalo|instala|descompact[ae]\w*|anex[ae]|anexar|resum[ae]|resumir|compar[ae]|comparar)\b|\b(luego|despu[eé]s|y (abre|instala|ejecuta|descomprime|adjunta|env[ií]a|compara|resume))\b/i.test(command);
}

/** O pedido é de VÁRIOS arquivos ("os dois", "todos", "3 vídeos") — aí a tarefa não acaba no 1º download. */
export function commandWantsSeveralFiles(command: string): boolean {
  return /\b([2-9]|\d{2,}|two|three|four|five|six|seven|eight|nine|ten|both|all|every|several|dois|duas|tr[eê]s|quatro|cinco|ambos|ambas|todos|todas|v[aá]rios|v[aá]rias|dos|cuatro|varios|varias)\b/i.test(command);
}

/** O download é o fim do pedido (um arquivo, nada depois). */
export function downloadIsLastStep(command: string): boolean {
  return !commandWantsSeveralFiles(command) && !commandHasFollowUp(command);
}
