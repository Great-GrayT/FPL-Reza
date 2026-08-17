import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderDoc, slugify } from './markdown.js';

describe('renderDoc', () => {
  it('reads the frontmatter and drops it from the body', () => {
    const doc = renderDoc(
      [
        '---',
        'title: How it works',
        'updated: 2026-08-18',
        'status: active',
        '---',
        '',
        'Text.',
      ].join('\n'),
    );

    assert.equal(doc.title, 'How it works');
    assert.equal(doc.updated, '2026-08-18');
    assert.equal(doc.status, 'active');
    assert.equal(doc.html, '<p>Text.</p>');
  });

  it('collects headings with slug ids for the contents list', () => {
    const doc = renderDoc('## Data flow\n\n### Inputs and models\n');

    assert.deepEqual(doc.headings, [
      { id: 'data-flow', text: 'Data flow', level: 2 },
      { id: 'inputs-and-models', text: 'Inputs and models', level: 3 },
    ]);
    assert.match(doc.html, /<h2 id="data-flow">Data flow<\/h2>/);
    assert.match(doc.html, /<h3 id="inputs-and-models">/);
  });

  it('joins a wrapped paragraph into one block', () => {
    const doc = renderDoc('One sentence\nwrapped over two lines.\n\nA second block.\n');

    assert.equal(doc.html, '<p>One sentence wrapped over two lines.</p>\n<p>A second block.</p>');
  });

  it('renders inline code, emphasis, and http links', () => {
    const doc = renderDoc('Call `runSync` for **every** source at [FPL](https://fantasy.example).');

    assert.equal(
      doc.html,
      '<p>Call <code>runSync</code> for <strong>every</strong> source at <a href="https://fantasy.example" rel="noreferrer">FPL</a>.</p>',
    );
  });

  it('keeps a repository link as a visible path, since it cannot resolve in a browser', () => {
    const doc = renderDoc('See [Core spec](../packages/core/SPEC.md) for detail.');

    assert.equal(
      doc.html,
      '<p>See Core spec <span class="docPath">../packages/core/SPEC.md</span> for detail.</p>',
    );
  });

  it('leaves a number in prose alone while restoring code spans', () => {
    const doc = renderDoc('A `12` by 8 grid over 38 gameweeks and 5 channels.');

    assert.equal(doc.html, '<p>A <code>12</code> by 8 grid over 38 gameweeks and 5 channels.</p>');
  });

  it('renders a pipe table inside its own scroll container', () => {
    const doc = renderDoc(
      ['| Source | Shape |', '| --- | --- |', '| FPL API | JSON |', '| Odds CSV | CSV |'].join(
        '\n',
      ),
    );

    assert.equal(
      doc.html,
      '<div class="docTableScroll"><table><thead><tr><th scope="col">Source</th><th scope="col">Shape</th></tr></thead><tbody><tr><td>FPL API</td><td>JSON</td></tr><tr><td>Odds CSV</td><td>CSV</td></tr></tbody></table></div>',
    );
  });

  it('renders a bullet list and folds an indented continuation into its item', () => {
    const doc = renderDoc('- First item\n  continued here\n- Second item\n');

    assert.equal(doc.html, '<ul><li>First item continued here</li><li>Second item</li></ul>');
  });

  it('renders a fenced block without treating its content as markdown', () => {
    const doc = renderDoc('```sh\npnpm verify\n## not a heading\n```\n');

    assert.equal(doc.html, '<pre><code>pnpm verify\n## not a heading</code></pre>');
  });

  it('escapes markup in the document rather than emitting it', () => {
    const doc = renderDoc('A <script>alert(1)</script> tag and an & ampersand.\n');

    assert.equal(
      doc.html,
      '<p>A &lt;script&gt;alert(1)&lt;/script&gt; tag and an &amp; ampersand.</p>',
    );
  });

  it('renders the project document it exists for', () => {
    const doc = renderDoc(
      [
        '---',
        'title: How this project works',
        'updated: 2026-08-18',
        '---',
        '',
        '## Purpose',
        '',
      ].join('\n'),
    );

    assert.equal(doc.title, 'How this project works');
    assert.deepEqual(doc.headings, [{ id: 'purpose', text: 'Purpose', level: 2 }]);
  });
});

describe('slugify', () => {
  it('reduces a heading to a url safe fragment', () => {
    assert.equal(slugify('Data flow'), 'data-flow');
    assert.equal(slugify('Inputs, models, and algorithms'), 'inputs-models-and-algorithms');
  });
});
