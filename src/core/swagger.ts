import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function createOpenapiDocument(app: INestApplication) {
  return SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('BorderFlow — Operation Borderless')
      .setDescription(
        'Simulated stablecoins and funding. Money is represented by decimal strings. Register or log in for a bearer session. Wallets and transactions require ownership. Fixed FX values are synthetic; inspect source and observation metadata.',
      )
      .setVersion('1.1.0')
      .addBearerAuth()
      .build(),
  );
}

export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup('docs', app, createOpenapiDocument(app), {
    jsonDocumentUrl: '/openapi.json',
  });
}
