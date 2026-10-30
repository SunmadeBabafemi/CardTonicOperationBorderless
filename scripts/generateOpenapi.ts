import 'reflect-metadata';
import { writeFile } from 'node:fs/promises';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { createOpenapiDocument } from '../src/core/swagger';

async function generate() {
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    await writeFile(
      'docs/openapi.json',
      `${JSON.stringify(createOpenapiDocument(app), null, 2)}\n`,
    );
  } finally {
    await app.close();
  }
}
void generate().catch(() => {
  process.stderr.write(
    'OpenAPI generation failed; check database availability.\n',
  );
  process.exitCode = 1;
});
