
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, '../web');
const indexHtmlPath = path.join(webRoot, 'index.html');

const FUNNEL_FIELDS = [
  'country',
  'device_type',
  'event_name',
  'first_seen_date',
  'screen_element_name',
  'screen_name',
  'session_id',
  'timestamp',
  'User_ID'
];

const PAGE_LIMIT = 2000;
const ROW_CAP = 10000;
const MAX_PAGES = 5;

async function invoke(req, capability, input) {
  const token = req.header('X-Knowi-Capability-Token');
  const gatewayUrl = process.env.KNOWI_GATEWAY_URL;
  const resp = await fetch(gatewayUrl + '/v1/capabilities', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Knowi-Capability-Token': token
    },
    body: JSON.stringify({ capability, input })
  });
  const text = await resp.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }
  if (!resp.ok) {
    const message = (parsed && parsed.error) || `Capability ${capability} failed with status ${resp.status}`;
    throw new Error(message);
  }
  return parsed;
}

const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/api/funnel-data', async (req, res) => {
  try {
    const filters = [];
    const from = typeof req.query.from === 'string' ? req.query.from : '';
    const to = typeof req.query.to === 'string' ? req.query.to : '';
    if (from) filters.push({ field: 'first_seen_date', operator: 'gte', value: from });
    if (to) filters.push({ field: 'first_seen_date', operator: 'lte', value: to });

    let rows = [];
    let columns = null;
    let offset = 0;
    let truncated = false;

    for (let i = 0; i < MAX_PAGES; i++) {
      const result = await invoke(req, 'data.query', {
        binding: 'funnel-data',
        fields: FUNNEL_FIELDS,
        filters,
        limit: PAGE_LIMIT,
        offset
      });
      columns = result.columns;
      rows = rows.concat(result.rows || []);

      if (result.truncated && result.nextOffset != null && rows.length < ROW_CAP) {
        offset = result.nextOffset;
        truncated = true;
      } else {
        truncated = Boolean(result.truncated);
        break;
      }
    }

    res.json({ columns, rows, truncated, totalFetched: rows.length });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to load funnel data' });
  }
});

app.use(express.static(webRoot));

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(indexHtmlPath);
});

app.listen(Number(process.env.PORT), '0.0.0.0');
