/** Telefone brasileiro no formato aceito pelo sistema: **DDD + 9 + 8 dígitos**.
 *
 * São 11 dígitos, e o terceiro é obrigatoriamente `9`. Fixo não entra: o
 * telefone aqui não é um dado de contato qualquer — é o **usuário do login**
 * (`login_provisioning` monta o `username` a partir dos dígitos) e o canal por
 * onde o organizador chama a pessoa para o jogo. Um número de 10 dígitos gerava
 * um login que a pessoa digitava errado na primeira tentativa.
 */
const DIGITOS_ESPERADOS = 11;
const POSICAO_DO_NONO = 2;

/** Só os dígitos, já sem o prefixo do país.
 *
 * Mesma regra do servidor (`players.models.normalize_phone`): o `55` sai quando
 * vem colado num número completo. Sem isso, colar "+55 11 91434-4257" do
 * WhatsApp — que é como o número chega — viraria "(55) 11914-3442" na tela,
 * discordando do `phone_digits` que o servidor grava. E `55` sozinho na frente
 * de um número já completo é o DDD do Rio Grande do Sul, não prefixo de país,
 * então ele só é descartado quando **sobra** dígito.
 */
export function phoneDigits(value: string): string {
  const digitos = value.replace(/\D/g, "");
  const semPais =
    digitos.length > DIGITOS_ESPERADOS && digitos.startsWith("55") ? digitos.slice(2) : digitos;
  return semPais.slice(0, DIGITOS_ESPERADOS);
}

/** Máscara aplicada enquanto a pessoa digita.
 *
 * Formata a partir dos **dígitos**, nunca do texto já mascarado — é isso que
 * faz o apagar funcionar. Uma máscara que devolve o separador assim que ele é
 * apagado prende o cursor: "(11) " vira "(11)" no backspace, é reformatado
 * para "(11) " de novo e a pessoa não sai dali. Por isso nenhum separador é
 * acrescentado no fim: ele só aparece quando existe um dígito depois dele.
 */
export function formatPhone(value: string): string {
  const digitos = phoneDigits(value);
  if (digitos.length <= 2) return digitos ? `(${digitos}` : "";
  if (digitos.length <= 7) return `(${digitos.slice(0, 2)}) ${digitos.slice(2)}`;
  return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
}

/** `null` quando está certo; a mensagem do que está errado quando não está.
 *
 * Vazio é válido: nem toda ficha tem telefone (convidado avulso, jogador que
 * não passou o número), e exigir um number aqui impediria de cadastrar quem
 * joga. A regra é "se preencheu, preencheu certo".
 */
export function phoneError(value: string): string | null {
  const digitos = phoneDigits(value);
  if (!digitos) return null;
  if (digitos.length !== DIGITOS_ESPERADOS) {
    return `O telefone precisa ter ${DIGITOS_ESPERADOS} dígitos: DDD + 9 + o número. Faltam ${
      DIGITOS_ESPERADOS - digitos.length
    }.`;
  }
  if (digitos[POSICAO_DO_NONO] !== "9") {
    return "Depois do DDD, o número precisa começar com 9 (celular).";
  }
  return null;
}
