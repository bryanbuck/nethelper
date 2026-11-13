/**
 * MAC vendor names from the bundled IEEE registry table (utils/oui.js) and
 * the update script that builds it (scripts/update-oui.js).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const oui = require('../../src/utils/oui');
const { build } = require('../../scripts/update-oui');

const HEADER = 'Registry,Assignment,Organization Name,Organization Address\n';

afterEach(() => oui._setFile(null));

describe('parseCsv', () => {
  test('handles quoted fields, doubled quotes, commas and newlines inside quotes', () => {
    const rows = oui.parseCsv('a,"b, c","say ""hi""","line1\nline2"\r\nx,y,,z\n');
    expect(rows).toEqual([['a', 'b, c', 'say "hi"', 'line1\nline2'], ['x', 'y', '', 'z']]);
  });
});

describe('shortenName', () => {
  test.each([
    ['Cisco Systems, Inc', 'Cisco'],
    ['Apple, Inc.', 'Apple'],
    ['AMERICAN POWER CONVERSION CORP', 'APC'],
    ['Nokia Shanghai Bell Co., Ltd.', 'Nokia Shanghai Bell'],
    ['Shenzhen Foo Technology Co.,Ltd', 'Shenzhen Foo Technology'],
    ['Wistron InfoComm(Kunshan)Co.,Ltd.', 'Wistron InfoComm(Kunshan)'],
    ['Katun Corporation', 'Katun'],
    ['Siemens AG', 'Siemens'],
    ['SAMSUNG ELECTRO-MECHANICS(THAILAND)', 'Samsung Electro-Mechanics(Thailand)'],
    ['TCL KING ELECTRICAL APPLIANCES (HUIZHOU) CO., LTD', 'TCL King Electrical Appliances (Huizhou)'],
    ['Aruba, a Hewlett Packard Enterprise Company', 'Aruba Networks (HPE)'],
    ['Zinc', 'Zinc'],
    ['Texas Instruments', 'Texas Instruments'],
    ['snom technology GmbH', 'snom technology'],
  ])('%s -> %s', (raw, short) => {
    expect(oui.shortenName(raw)).toBe(short);
  });

  test('blocks IEEE re-divided and private registrations name nobody', () => {
    expect(oui.shortenName('IEEE Registration Authority')).toBeNull();
    expect(oui.shortenName('Private')).toBeNull();
    expect(oui.shortenName('  ')).toBeNull();
  });
});

describe('buildEntries / formatTable', () => {
  test('keeps prefix and shortened name, drops the address and malformed rows', () => {
    const entries = oui.buildEntries(`${HEADER}MA-L,00000C,"Cisco Systems, Inc","170 West Tasman Dr. San Jose CA US 95134 "\nMA-L,BADROW,Nobody,\nMA-L,0050C2,IEEE Registration Authority,x\n`);
    expect(entries).toEqual([['00000C', 'Cisco']]);
  });

  test('refuses a CSV whose header is not the registry format', () => {
    expect(() => oui.buildEntries('a,b,c\n1,2,3\n')).toThrow(/header/);
  });

  test('formatTable sorts, de-duplicates and records the source and counts', () => {
    const text = oui.formatTable([['0050C2', 'B'], ['00000C', 'A'], ['00000C', 'A']], { downloadedAt: '2026-11-12', counts: { 'MA-L': 2 } });
    expect(text).toMatch(/IEEE Registration Authority/);
    expect(text).toMatch(/# downloaded: 2026-11-12/);
    expect(text.trim().split('\n').filter((l) => !l.startsWith('#'))).toEqual(['00000C\tA', '0050C2\tB']);
  });
});

describe('lookup', () => {
  function useTable(lines) {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oui-')), 'oui.tsv');
    fs.writeFileSync(file, `# downloaded: 2026-11-12\n${lines.join('\n')}\n`);
    oui._setFile(file);
  }

  test('longest prefix wins: MA-S, then MA-M, then MA-L', () => {
    useTable(['70B3D5\tUnused', '70B3D51\tBlock M', '70B3D5123\tBlock S', '00000C\tCisco']);
    expect(oui.lookup('70:b3:d5:12:34:56')).toBe('Block S');
    expect(oui.lookup('70-B3-D5-1F-00-00')).toBe('Block M');
    expect(oui.lookup('70b3.d5ff.0000')).toBe('Unused');
    expect(oui.lookup('00:00:0c:aa:bb:cc')).toBe('Cisco');
    expect(oui.lookup('00:00:0d:aa:bb:cc')).toBeNull();
    expect(oui.tableInfo()).toEqual({ downloadedAt: '2026-11-12', entries: 4 });
  });

  test('a random (locally administered) MAC or garbage has no vendor', () => {
    useTable(['02000C\tNobody']);
    expect(oui.lookup('02:00:0c:00:00:01')).toBeNull();
    expect(oui.lookup('not a mac')).toBeNull();
    expect(oui.lookup(null)).toBeNull();
  });

  test('a missing table returns null instead of throwing', () => {
    oui._setFile(path.join(os.tmpdir(), 'no-such-dir', 'oui.tsv'));
    expect(oui.lookup('00:00:0c:00:00:01')).toBeNull();
    expect(oui.tableInfo()).toBeNull();
  });
});

describe('the bundled table (src/data/oui.tsv)', () => {
  test('is present, complete and modest in size', () => {
    const stat = fs.statSync(oui.DEFAULT_FILE);
    expect(stat.size).toBeLessThan(3 * 1024 * 1024);
    const info = oui.tableInfo();
    expect(info.entries).toBeGreaterThan(45000);
    expect(info.downloadedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(oui.lookup('00:00:0c:00:00:01')).toBe('Cisco');
    expect(oui.lookup('00:50:56:00:00:01')).toBe('VMware');
    expect(oui.lookup('b8:27:eb:00:00:01')).toBe('Raspberry Pi');
  });
});

describe('scripts/update-oui.js build', () => {
  const csv = (rows) => HEADER + rows.map(([p, n]) => `X,${p},"${n}",addr`).join('\n');
  test('builds one table from the three lists', () => {
    const { text, counts } = build({
      'MA-L': csv([['00000C', 'Cisco Systems, Inc']]),
      'MA-M': csv([['70B3D51', 'Foo Ltd']]),
      'MA-S': csv([['70B3D5123', 'Bar GmbH']]),
    }, { downloadedAt: '2026-11-12' });
    expect(counts).toEqual({ 'MA-L': 1, 'MA-M': 1, 'MA-S': 1 });
    expect(text).toMatch(/^00000C\tCisco$/m);
    expect(text).toMatch(/^70B3D5123\tBar$/m);
  });

  test('refuses to write from a cut download', () => {
    expect(() => build({ 'MA-L': csv([['00000C', 'Cisco']]), 'MA-M': '', 'MA-S': '' }, { minimums: { 'MA-L': 30000 } }))
      .toThrow(/MA-L: only 1 entries/);
  });
});
