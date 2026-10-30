// Named migrations: `npm run migration:generate -- AddWalletLimits`
// and `npm run migration:create -- BackfillReferences`.
const { spawnSync } = require('node:child_process');
const { existsSync, readdirSync } = require('node:fs');
const path = require('node:path');

const MIGRATIONS = 'src/database/migrations';
const DATASOURCE = 'src/database/typeorm.datasource.ts';

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  return result.status ?? 1;
}

function main() {
  const [action, name = 'Migration'] = process.argv.slice(2);
  if (!['generate', 'create'].includes(action)) {
    console.error(
      'Usage: node scripts/migration.cjs <generate|create> [PascalCaseName]',
    );
    return 1;
  }
  if (!/^[A-Z][A-Za-z0-9]{0,99}$/.test(name)) {
    console.error(
      `Migration name must be PascalCase letters and digits, got "${name}".`,
    );
    return 1;
  }
  const before = new Set(existsSync(MIGRATIONS) ? readdirSync(MIGRATIONS) : []);
  const bin = (tool) => path.join('node_modules', '.bin', tool);
  const status =
    action === 'generate'
      ? run(bin('typeorm-ts-node-commonjs'), [
          'migration:generate',
          `${MIGRATIONS}/${name}`,
          '-d',
          DATASOURCE,
          '--pretty',
        ])
      : run(bin('typeorm'), ['migration:create', `${MIGRATIONS}/${name}`]);
  if (status !== 0) return status;
  // TypeORM writes double-quoted code; format new files to the repo style.
  const created = readdirSync(MIGRATIONS)
    .filter((file) => !before.has(file))
    .map((file) => path.join(MIGRATIONS, file));
  return created.length ? run(bin('prettier'), ['--write', ...created]) : 0;
}

process.exitCode = main();
