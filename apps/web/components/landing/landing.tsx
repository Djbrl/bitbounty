// L1: the landing page, ported from Djbrl/bitbounty-landing index.html (French, same markup and
// classes; styles in app/(marketing)/landing.css). The CTAs start GitHub sign-in on this site
// (/start → /welcome?intent=…); signed-in visitors get "Ouvrir l'app" instead.
import type { WorkspaceMode } from "@bitbounty/core";
import { APP_PATH } from "../../lib/auth/workspace";
import { AFRICA_SVG } from "./africa-map";
import { trailerEmbedUrl, type LandingConfig } from "./config";
import { GraphStory } from "./graph-story";

export const START_PATH = "/start";

/** `/start?intent=…`: GitHub sign-in, then /welcome with that intent (or the workspace if onboarded). */
export const startHref = (intent: WorkspaceMode) => `${START_PATH}?intent=${intent}`;

export const CTA_LABEL: Record<WorkspaceMode, string> = {
  maintain: "Financer une issue",
  hunt: "Être payé pour corriger",
};

/** The pair of CTAs (pill + link). `lead` is the pill; signed in, both become "Ouvrir l'app" + the board. */
function Ctas({ signedIn, lead }: { signedIn: boolean; lead: WorkspaceMode }) {
  if (signedIn) {
    return (
      <div className="ctas">
        <a className="pill green" href={APP_PATH}>
          Ouvrir l&apos;app
        </a>
        <a className="link" href="/explore">
          Voir les issues payées ›
        </a>
      </div>
    );
  }
  const other: WorkspaceMode = lead === "hunt" ? "maintain" : "hunt";
  return (
    <div className="ctas">
      <a className="pill green" href={startHref(lead)} rel="nofollow">
        {CTA_LABEL[lead]}
      </a>
      <a className="link" href={startHref(other)} rel="nofollow">
        {CTA_LABEL[other]} ›
      </a>
    </div>
  );
}

export function Landing({ signedIn, config }: { signedIn: boolean; config: LandingConfig }) {
  const trailer = trailerEmbedUrl(config.trailerYoutubeId);
  return (
    <>
      <header className="nav">
        <div className="nav-in">
          <a className="brand" href="#top" aria-label="Accueil BitBounty">
            <svg width="20" height="20" viewBox="0 0 30 30" aria-hidden="true"><path d="M8 4v22" stroke="currentColor" strokeWidth="2.8" fill="none" strokeLinecap="round"/><path d="M8 9c0 6 4 9 10.5 9.5" stroke="currentColor" strokeWidth="2.8" fill="none" strokeLinecap="round"/><circle cx="21.5" cy="18.5" r="5.2" fill="var(--green)"/></svg>
            BitBounty
          </a>
          <nav>
            <a href="#how">Comment ça marche</a>
            <a href="#bounties">Issues payées</a>
            <a href="#trailer">Bande-annonce</a>
            {signedIn ? (
              <a className="pill dark" href={APP_PATH}>
                Ouvrir l&apos;app
              </a>
            ) : (
              <a className="pill dark" href={START_PATH} rel="nofollow">
                Se connecter
              </a>
            )}
          </nav>
        </div>
      </header>

      <main>
        <section id="top" className="hero">
          <span className="product">BitBounty</span>
          <h1>Faites-vous payer<br />pour contribuer.</h1>
          <p className="sub">Des issues GitHub financées, payées en FCFA sur Wave dès le merge.</p>
          <Ctas signedIn={signedIn} lead="hunt" />

          <div className="laptop" id="laptop" aria-label="L'ordinateur d'un mainteneur, affichant les issues d'un dépôt GitHub">
            <div className="lid">
              <div className="screen">
                <div className="gh-bar"><span className="gh-dots"><i></i><i></i><i></i></span><span className="gh-url">github.com/bitnob-community/bitnob-js/issues</span></div>
                <div className="gh-head">
                  <span className="gh-repo"><b>bitnob-community</b> / <b>bitnob-js</b></span>
                  <span className="gh-tabs"><span>Code</span><span className="on">Issues <em>41</em></span><span>Pull requests <em>3</em></span><span>Actions</span></span>
                </div>
                <ul className="gh-issues">
                  <li className="hot"><span className="gh-open"></span><span><b>Retry payouts.finalize() on 5xx</b><small>#12 opened 47 days ago</small></span><span className="gh-label bounty">bounty · 10 000 F</span></li>
                  <li><span className="gh-open"></span><span><b>Typed models for card webhooks</b><small>#18 opened 3 weeks ago</small></span><span className="gh-label">enhancement</span></li>
                  <li><span className="gh-open"></span><span><b>README: HMAC signing example in Python</b><small>#23 opened 2 weeks ago</small></span><span className="gh-label">docs</span></li>
                  <li><span className="gh-open"></span><span><b>Pagination helper for list endpoints</b><small>#27 opened 9 days ago</small></span></li>
                  <li><span className="gh-open"></span><span><b>Translate error messages to French</b><small>#31 opened 4 days ago</small></span><span className="gh-label">good first issue</span></li>
                </ul>
              </div>
            </div>
            <div className="base"><i></i></div>
          </div>
        </section>

        <GraphStory>
          <div className="g-stop" data-stop="post">
            <div className="g-text"><span className="g-branch mono">main</span><h3>Publier une bounty.</h3><p>Un seul commentaire sur l'issue.</p></div>
            <div className="g-visual">
              <div className="v-card">
                <div className="v-comment"><span className="avatar xs" style={{ background: "#C2662D" }}>M</span><span><b>mamadou-dev</b> a commenté</span></div>
                <code className="v-code">/bounty 10000</code>
                <div className="v-bot"><span className="v-botmark"><svg width="14" height="14" viewBox="0 0 30 30" aria-hidden="true"><path d="M8 4v22" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round"/><path d="M8 9c0 6 4 9 10.5 9.5" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round"/><circle cx="21.5" cy="18.5" r="5.2" fill="#F2A007"/></svg></span><span><b>bitbounty</b> · 10 000 FCFA · en attente de financement</span></div>
              </div>
            </div>
          </div>

          <div className="g-stop" data-stop="fund">
            <div className="g-text"><span className="g-branch mono">bounty/fund</span><h3>Financée en sats.</h3><p>Depuis Paris, en une seconde environ.</p></div>
            <div className="g-visual">
              <div className="v-flow">
                <span className="tag amber big"><svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true"><path d="M8 1L2 9h4l-1 6 6-8H7l1-6z" fill="currentColor"/></svg>16 820 sats</span>
                <svg className="v-arrow" width="24" height="34" viewBox="0 0 24 34" aria-hidden="true"><path d="M12 2v26M6 22l6 6 6-6" stroke="#0B1F17" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <span className="v-bitnob"><img src="/landing/bitnob-logo-white.svg" alt="Bitnob" width="132" height="29" /></span>
                <svg className="v-arrow" width="24" height="34" viewBox="0 0 24 34" aria-hidden="true"><path d="M12 2v26M6 22l6 6 6-6" stroke="#0B1F17" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <span className="v-held"><svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="9" width="12" height="9" rx="2" fill="#1F9D55"/><path d="M7 9V6.5a3 3 0 016 0V9" stroke="#1F9D55" strokeWidth="2" fill="none"/></svg>Bloqués jusqu'au merge</span>
              </div>
            </div>
          </div>

          <div className="g-stop" data-stop="claim">
            <div className="g-text"><span className="g-branch mono">main</span><h3>Réclamée à Dakar.</h3><p>La communauté de développeurs qui grandit le plus vite au monde.</p></div>
            <div className="g-visual">
              <div className="v-map">
                <svg className="africa" viewBox="0 0 460 476" role="img" aria-label="Carte de l'Afrique : des centaines de points représentent les développeurs, Dakar est mis en avant" dangerouslySetInnerHTML={{ __html: AFRICA_SVG }} />
                <div className="v-mapfoot"><span className="avatar xs" style={{ background: "#C2662D" }}>AS</span><span><b>@awa-sow</b> · Dakar, Sénégal</span><code>/claim</code></div>
                <div className="v-stat"><b>+3,4 M</b><span>nouveaux développeurs sur GitHub en Afrique et au Moyen-Orient, en un an</span><small>GitHub Octoverse 2025</small></div>
              </div>
            </div>
          </div>

          <div className="g-stop" data-stop="push">
            <div className="g-text"><span className="g-branch mono purple-t">awa-sow/fix-retry</span><h3>Correctif poussé.</h3><p>Un vrai correctif, sur un vrai dépôt.</p></div>
            <div className="g-visual">
              <div className="v-diff">
                <div className="v-diff-head mono">src/payouts.ts <span>+5 −1</span></div>
                <pre className="mono">
                  <span className="del">{"- return await finalize(ref)"}</span>
                  {"\n"}<span className="add">{"+ for (let i = 0; i < 3; i++) {"}</span>
                  {"\n"}<span className="add">{"+   const res = await finalize(ref)"}</span>
                  {"\n"}<span className="add">{"+   if (res.ok) return res"}</span>
                  {"\n"}<span className="add">{"+   await sleep(400 * 2 ** i)"}</span>
                  {"\n"}<span className="add">{"+ }"}</span>
                </pre>
              </div>
            </div>
          </div>

          <div className="g-stop" data-stop="review">
            <div className="g-text"><span className="g-branch mono purple-t">awa-sow/fix-retry</span><h3>Vérifiée par l'IA.<br />Validée par un humain.</h3><p>L'IA vérifie chaque critère. Le mainteneur a le dernier mot.</p></div>
            <div className="g-visual">
              <ul className="v-checks">
                <li><i></i>Réessaie 3 fois, avec un délai croissant</li>
                <li><i></i>Même référence à chaque tentative</li>
                <li><i></i>Testé avec un 503, puis un 200</li>
                <li className="v-checks-foot mono">3/3 critères · 21 s</li>
                <li className="v-human"><span className="avatar xs" style={{ background: "#C2662D" }}>M</span><span><b>@mamadou-dev</b> a approuvé</span><span className="v-approved">Approuvé</span></li>
                <li className="v-integr">Intégration possible avec votre outil de revue, comme <b>CodeRabbit</b>.</li>
              </ul>
            </div>
          </div>

          <div className="g-stop" data-stop="merge">
            <div className="g-text"><span className="g-branch mono purple-t">main</span><h3>Mergée.</h3><p>Le mainteneur relit et merge, comme d'habitude.</p></div>
            <div className="g-visual">
              <div className="v-merged">
                <span className="v-merged-icon"><svg width="22" height="22" viewBox="0 0 18 18" aria-hidden="true"><circle cx="4.5" cy="3.5" r="2" stroke="#fff" strokeWidth="1.8" fill="none"/><circle cx="4.5" cy="14.5" r="2" stroke="#fff" strokeWidth="1.8" fill="none"/><circle cx="13.5" cy="9" r="2" stroke="#fff" strokeWidth="1.8" fill="none"/><path d="M4.5 5.5v7M4.5 5.5c0 3 3 3.5 7 3.5" stroke="#fff" strokeWidth="1.8" fill="none"/></svg></span>
                <span><b>Pull request mergée avec succès</b><small>#34 Retry payouts on 5xx · Fixes #12</small></span>
              </div>
            </div>
          </div>

          <div className="g-end" data-stop="paid">
            <div className="g-end-text"><h3>Payée sur Wave.<br />Six minutes plus tard.</h3></div>
            <div className="end-phone">
              <div className="ep-screen">
                <span className="clock">18:51</span>
                <span className="date">dimanche 18 octobre</span>
                <div className="notif"><i>W</i><span><b>Wave</b> · now<br />Vous avez reçu 10 000 F.</span></div>
              </div>
            </div>
            <div className="g-end-amount"><span className="money">10 000<br />FCFA</span></div>
          </div>
        </GraphStory>

        <section className="tiles">
          <div id="bounties" className="tile light">
            <h2>Des issues qui paient.</h2>
            <p>Déjà financées. Payées dans votre monnaie.</p>
            <a className="link" href={config.demoPath}>Parcourir les issues payées ›</a>
            <ul className="list">
              <li><span><b>Retry payouts on 5xx</b><small>bitnob-js #12</small></span><em>10 000 F</em></li>
              <li><span><b>Typed webhook models</b><small>bitnob-py #4</small></span><em>₦25 000</em></li>
              <li><span><b>Onboarding in Wolof</b><small>demo-app #7</small></span><em>3 000 F</em></li>
              <li><span><b>Checkout test over 3G</b><small>kaay-shop #51</small></span><em>5 000 F</em></li>
            </ul>
          </div>

          <div id="maintainers" className="tile dark">
            <h2>Votre backlog, corrigé.</h2>
            <p>Ne payez que ce que vous mergez.</p>
            <a className="link green-t" href={config.githubAppUrl} target="_blank" rel="noopener">Installer sur GitHub ›</a>
            <div className="cmd">
              <code>/bounty 10000</code>
              <svg width="24" height="40" viewBox="0 0 24 40" aria-hidden="true"><path d="M12 2v32M5 28l7 7 7-7" stroke="var(--green-bright)" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <span className="tag bright">Financée · bloquée jusqu'au merge</span>
            </div>
          </div>

          <div className="tile light">
            <h2>Là où les autres s'arrêtent.</h2>
            <p>Se faire payer depuis Dakar, aujourd'hui.</p>
            <ul className="versus">
              <li><span>PayPal</span><svg width="22" height="22" viewBox="0 0 20 20" role="img" aria-label="non"><path d="M5 5l10 10M15 5L5 15" stroke="#B4412B" strokeWidth="2.4" strokeLinecap="round"/></svg></li>
              <li><span>Bounties via Stripe</span><svg width="22" height="22" viewBox="0 0 20 20" role="img" aria-label="non"><path d="M5 5l10 10M15 5L5 15" stroke="#B4412B" strokeWidth="2.4" strokeLinecap="round"/></svg></li>
              <li className="win"><span>BitBounty</span><svg width="22" height="22" viewBox="0 0 20 20" role="img" aria-label="oui"><path d="M4 10.5l4 4 8-9" stroke="var(--green)" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg></li>
            </ul>
          </div>

          <div className="tile light">
            <h2>Construit sur Bitnob.</h2>
            <p>Du premier sat au dernier franc.</p>
            <div className="flow">
              <span className="tag amber lg">sats · USDT · ₦</span>
              <svg width="24" height="30" viewBox="0 0 24 30" aria-hidden="true"><path d="M12 2v22M6 18l6 6 6-6" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <span className="tag ink xl2">Bitnob</span>
              <svg width="24" height="30" viewBox="0 0 24 30" aria-hidden="true"><path d="M12 2v22M6 18l6 6 6-6" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <span className="tag greenbg lg">Wave · Orange Money · MTN</span>
            </div>
          </div>
        </section>

        <section id="trailer" className="trailer">
          <h2>Regardez la bande-annonce.</h2>
          <div className="video">
            {trailer ? (
              <iframe
                src={trailer}
                title="BitBounty trailer"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <div className="video-soon">
                <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="31" fill="rgba(255,255,255,0.12)"/><path d="M26 20l20 12-20 12z" fill="#fff"/></svg>
                <span>Première au Demo Day, dimanche 15 h</span>
              </div>
            )}
          </div>
          <a className="pill green" href={config.demoPath}>Ouvrir la démo en direct</a>
        </section>

        <section className="closing">
          <h2>Votre prochain contributeur<br />est à Dakar.</h2>
          <Ctas signedIn={signedIn} lead="maintain" />
        </section>
      </main>

      <footer>
        <div className="foot-in">
          <span>BitBounty · Code &amp; Chain Dakar 2026 · paiements par <a href="https://bitnob.dev" rel="noopener">Bitnob</a></span>
          <span><a href={config.repoUrl} rel="noopener">GitHub</a> · montants et noms donnés à titre d'exemple</span>
        </div>
      </footer>
    </>
  );
}
