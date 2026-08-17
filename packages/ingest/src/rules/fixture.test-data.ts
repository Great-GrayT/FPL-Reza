/**
 * Trimmed copy of the published rules page structure: the same tables and the
 * same sentences the parser keys on, with the bulk of the prose removed.
 */
export const RULES_HTML_SAMPLE = `<!doctype html>
<html><body>
  <h2>Selecting Your Initial Squad</h2>
  <h3>Squad Size</h3>
  <p>To join the game select a fantasy football squad of 15 players, consisting of:</p>
  <ul><li>2 Goalkeepers</li><li>5 Defenders</li><li>5 Midfielders</li><li>3 Forwards</li></ul>
  <h3>Budget</h3>
  <p>The total value of your initial squad must not exceed &pound;100 million.</p>
  <h3>Players Per Team</h3>
  <p>You can select up to 3 players from a single Premier League team.</p>

  <h2>Transfers</h2>
  <p>Each additional transfer you make in the same Gameweek will deduct 4 points from your total score.</p>
  <p>The maximum number of free transfers you can store in any Gameweek is 5.</p>
  <p>At other times you are limited to 20 transfers in any single Gameweek.</p>

  <h2>Chips</h2>
  <table>
    <tr><th>Name</th><th>Effect</th></tr>
    <tr><td>Bench Boost</td><td>The points scored by your bench players are included.</td></tr>
    <tr><td>Triple Captain</td><td>Your captain points are tripled instead of doubled.</td></tr>
  </table>

  <h2>Deadlines</h2>
  <table>
    <tr><th>Gameweek</th><th>Deadline</th></tr>
    <tr><td>Gameweek 1</td><td>Fri 21 Aug 18:30</td></tr>
    <tr><td>Gameweek 19</td><td>Sat 2 Jan 13:30</td></tr>
    <tr><td>Gameweek 38</td><td>Sun 30 May 14:30</td></tr>
  </table>

  <h2>Scoring</h2>
  <table>
    <tr><th>Action</th><th>Points</th></tr>
    <tr><td>For playing 60 minutes or more (excluding stoppage time)</td><td>2</td></tr>
    <tr><td>For each goal scored by a defender</td><td>6</td></tr>
    <tr><td>For each penalty miss</td><td>-2</td></tr>
    <tr><td>Bonus points for the best players in a match</td><td>1-3</td></tr>
  </table>

  <h2>Bonus Points</h2>
  <table>
    <tr><th>Action</th><th>BPS</th></tr>
    <tr><td>Playing over 60 minutes</td><td>6</td></tr>
    <tr><td>Assists</td><td>9</td></tr>
    <tr><td>Yellow card</td><td>-3</td></tr>
  </table>

  <h2>Leagues</h2>
  <table>
    <tr><th>Phase</th><th>First Gameweek</th><th>Last Gameweek</th></tr>
    <tr><td>Overall</td><td>Gameweek 1</td><td>Gameweek 38</td></tr>
    <tr><td>August</td><td>Gameweek 1</td><td>Gameweek 2</td></tr>
  </table>
</body></html>`;

/** Same page with a moved deadline and a changed scoring value. */
export const RULES_HTML_CHANGED = RULES_HTML_SAMPLE.replace(
  '<td>Fri 21 Aug 18:30</td>',
  '<td>Sat 22 Aug 11:00</td>',
).replace(
  '<td>For each goal scored by a defender</td><td>6</td>',
  '<td>For each goal scored by a defender</td><td>7</td>',
);

/** Client rendered variant: no tables, content only in the Next.js payload. */
export const RULES_HTML_NEXT_DATA = `<!doctype html>
<html><body><div id="root"></div>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  props: {
    pageProps: {
      body: 'Gameweek 1 Fri 21 Aug 18:30 Gameweek 2 Fri 28 Aug 18:30',
      squad: 'select a fantasy football squad of 15 players',
    },
  },
})}</script>
</body></html>`;
