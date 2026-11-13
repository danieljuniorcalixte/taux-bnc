// Lit le taux du dollar affiché par la BNC (Banque Nationale de Crédit, Haïti) sur https://www.bnconline.com/
// et l'écrit dans taux-bnc.json (et une ligne dans historique.csv quand il change).
// Lancé chaque matin par GitHub (voir .github/workflows/taux-bnc.yml). Aucune bibliothèque nécessaire (Node 20+).
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const URL_BNC = 'https://www.bnconline.com/';

const MOIS = {
  janvier: 1,
  fevrier: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  aout: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  decembre: 12,
};

const ENTITES = { nbsp: ' ', amp: '&', eacute: 'é', Eacute: 'É', egrave: 'è', ecirc: 'ê', agrave: 'à', ucirc: 'û', ocirc: 'ô', ccedil: 'ç', quot: '"', apos: "'", lt: '<', gt: '>' };

/** Texte visible de la page : sans balises, entités décodées, espaces simplifiés. */
export function texteDepuisHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, nom) => ENTITES[nom] ?? m)
    .replace(/[   ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const sansAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const nombre = (s) => Number(s.replace(/\s/g, '').replace(',', '.'));

/**
 * Cherche le bloc « TAUX DE CHANGE USD / HTG 12 novembre 2026 » puis, dans le tableau qui suit (MONTANT, ACHAT, VENTE),
 * la première ligne : achat et vente en gourdes. Lit aussi le taux de référence de la BRH s'il est affiché.
 */
export function lireTaux(html) {
  const texte = texteDepuisHtml(html);
  const plat = sansAccents(texte);
  const titre = plat.match(/TAUX\s+DE\s+CHANGE\s+USD\s*\/\s*HTG\s*:?\s*(\d{1,2})(?:er)?\s+([A-Za-z]+)\s+(\d{4})/i);
  if (!titre) throw new Error('Bloc « TAUX DE CHANGE USD / HTG <date> » introuvable sur la page');
  const mois = MOIS[titre[2].toLowerCase()];
  if (!mois) throw new Error(`Mois inconnu : ${titre[2]}`);
  const date = `${titre[3]}-${String(mois).padStart(2, '0')}-${String(titre[1]).padStart(2, '0')}`;

  // Le tableau d'achat et de vente s'arrête au bloc suivant (« TAUX DE RÉFÉRENCE BRH » ou un autre « TAUX DE CHANGE »).
  const suite = plat.slice(titre.index + titre[0].length, titre.index + titre[0].length + 500);
  const fin = suite.search(/TAUX\s+DE\s+(REFERENCE|CHANGE)/i);
  const zone = fin >= 0 ? suite.slice(0, fin) : suite;
  const montants = [...zone.matchAll(/(\d{2,4}(?:[.,]\d{1,4})?)\s*(?:HTG|GDES?|GOURDES?)\b/gi)].map((m) => nombre(m[1]));
  if (montants.length < 2) throw new Error('Taux d’achat et de vente introuvables après le titre');
  const [achat, vente] = montants;
  if (!(achat >= 50 && vente <= 1000 && achat <= vente && vente - achat <= 50)) {
    throw new Error(`Valeurs incohérentes : achat ${achat}, vente ${vente}`);
  }
  // Taux de référence : le montant qui suit directement « TAUX DE RÉFÉRENCE BRH » (et « 1 USD »).
  const brhMontant = plat.match(/TAUX\s+DE\s+REFERENCE\s+(?:DE\s+LA\s+)?BRH[\s:|*]*(?:1\s*USD[\s:=|*]*)?(\d{2,4}[.,]\d{1,4})\s*(?:HTG|GDES?)/i);
  const brh = brhMontant ? nombre(brhMontant[1]) : null;
  return { date, achat, vente, brh: brh !== null && brh >= 50 && brh <= 1000 ? brh : null };
}

async function telecharger(url, essais = 3) {
  let derniere;
  for (let i = 0; i < essais; i++) {
    try {
      const r = await fetch(url, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; NEXUS-taux/1.0; lecture une fois par matin du taux affiche)',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'fr-HT,fr;q=0.9',
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      derniere = e;
      await new Promise((ok) => setTimeout(ok, 10_000 * (i + 1)));
    }
  }
  throw new Error(`Site de la BNC injoignable : ${derniere?.message ?? derniere}`);
}

async function principal() {
  const html = await telecharger(process.env.URL_BNC || URL_BNC);
  const lu = lireTaux(html);
  const fichier = 'taux-bnc.json';
  const avant = existsSync(fichier) ? JSON.parse(readFileSync(fichier, 'utf8')) : null;
  const pareil = avant && avant.date === lu.date && avant.achat === lu.achat && avant.vente === lu.vente && (avant.brh ?? null) === lu.brh;
  console.log(`BNC du ${lu.date} : achat ${lu.achat}, vente ${lu.vente}${lu.brh ? `, référence BRH ${lu.brh}` : ''}`);
  if (pareil) {
    console.log('Rien de nouveau depuis la dernière lecture.');
    return;
  }
  const donnees = { source: 'Banque Nationale de Crédit (www.bnconline.com)', ...lu, lu_le: new Date().toISOString() };
  writeFileSync(fichier, JSON.stringify(donnees, null, 2) + '\n');
  if (!existsSync('historique.csv')) writeFileSync('historique.csv', 'date;achat;vente;brh;lu_le\n');
  appendFileSync('historique.csv', `${lu.date};${lu.achat};${lu.vente};${lu.brh ?? ''};${donnees.lu_le}\n`);
  console.log('taux-bnc.json mis à jour.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal().catch((e) => {
    console.error(`Lecture impossible : ${e.message}`);
    process.exitCode = 1;
  });
}
