// Chat panel: talks to Claude with the Lectern tools from bridge.js. Runs in the main process
// so the API key never reaches a web page. The key is stored encrypted with the operating
// system's keychain (Electron safeStorage).
const Anthropic = require('@anthropic-ai/sdk');

const AnthropicClient = Anthropic.default || Anthropic;
const MODEL = 'claude-opus-5-5';

const SYSTEM = [
  'You help the operator of Lectern, worship presentation software, during service preparation and live services.',
  'Use the tools to make the changes the operator asks for. Call get_overview first when you need to know what is in the service.',
  'Lectern shows the operator each change and asks them to approve it, so you do not need to ask for permission in chat first.',
  'If the operator declines a change, do not try it again unless they ask.',
  'Reply briefly in plain language, saying what you changed. Items are numbered from 1 in the service order and slides from 1 within an item.',
].join(' ');

class Chat {
  constructor({ bridge, getKey }) {
    this.bridge = bridge;
    this.getKey = getKey;
    this.messages = [];
    this.busy = false;
  }

  reset() { this.messages = []; }

  // Sends one operator message and runs tool calls until Claude finishes. onStep reports
  // progress ("Changing the text size…") to the panel.
  async send(text, onStep) {
    const key = this.getKey();
    if (!key) throw new Error('Add your Anthropic API key in Settings → Claude to use the chat panel.');
    if (this.busy) throw new Error('Claude is still working on your last message.');
    this.busy = true;
    const client = new AnthropicClient({ apiKey: key });
    const tools = this.bridge.tools();
    const start = this.messages.length;
    this.messages.push({ role: 'user', content: text });
    const done = [];
    try {
      for (let turn = 0; turn < 24; turn++) {
        const response = await client.beta.messages.create({
          model: MODEL,
          max_tokens: 16000,
          system: SYSTEM,
          tools,
          messages: this.messages,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        });
        // Keep the full content (including thinking blocks) so the conversation can continue.
        this.messages.push({ role: 'assistant', content: response.content });

        if (response.stop_reason === 'refusal') {
          return { text: 'Claude could not help with that request.', done };
        }
        if (response.stop_reason === 'pause_turn') continue;

        const calls = response.content.filter((b) => b.type === 'tool_use');
        if (response.stop_reason !== 'tool_use' || !calls.length) {
          const reply = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
          if (response.stop_reason === 'max_tokens') return { text: (reply ? reply + '\n\n' : '') + '(The reply was cut short.)', done };
          return { text: reply || 'Done.', done };
        }

        const results = [];
        for (const call of calls) {
          if (onStep) onStep(this.bridge.describe(call.name, call.input || {}));
          try {
            const r = await this.bridge.call(call.name, call.input || {}, 'chat panel');
            if (r && r.done) done.push(r.done);
            results.push({ type: 'tool_result', tool_use_id: call.id, content: typeof r === 'string' ? r : JSON.stringify(r) });
          } catch (e) {
            results.push({ type: 'tool_result', tool_use_id: call.id, content: String(e.message || e), is_error: true });
          }
        }
        this.messages.push({ role: 'user', content: results });
      }
      return { text: 'Stopped after many steps. Ask again to continue.', done };
    } catch (e) {
      // Drop this exchange so a failed request doesn't leave the conversation half-finished.
      this.messages.length = start;
      if (e instanceof AnthropicClient.AuthenticationError) throw new Error('The Anthropic API key was not accepted. Check it in Settings → Claude.');
      if (e instanceof AnthropicClient.RateLimitError) throw new Error('Claude is busy right now (rate limit). Try again in a minute.');
      if (e instanceof AnthropicClient.APIConnectionError) throw new Error('Could not reach Claude. Check the internet connection.');
      if (e instanceof AnthropicClient.APIError) throw new Error('Claude returned an error: ' + e.message);
      throw e;
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { Chat, MODEL };
