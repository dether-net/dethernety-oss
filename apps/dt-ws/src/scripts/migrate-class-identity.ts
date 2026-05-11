/**
 * CLI wrapper for the class-identity cleanup migration. The cleanup logic
 * itself lives in `ClassIdentityMigrationService` so it can be invoked
 * either from this CLI or from the `runIdentityMigration` admin GraphQL
 * mutation.
 *
 * Default mode is **dry-run**. Pass `--apply` to actually mutate the database.
 *
 * Usage:
 *   pnpm --filter dt-ws build && \
 *     pnpm --filter dt-ws migrate:class-identity            # dry-run
 *   pnpm --filter dt-ws build && \
 *     pnpm --filter dt-ws migrate:class-identity -- --apply # mutate
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ClassIdentityMigrationService } from '../gql/module-management-services/class-identity-migration.service';

async function bootstrap(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const migration = app.get(ClassIdentityMigrationService);
    const report = await migration.run({ apply });

    if (!apply && report.totalActions > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `\n[dry-run] ${report.totalActions} mutating action(s) would be performed. ` +
        `Re-run with --apply to execute.\n`,
      );
    }
  } finally {
    await app.close();
  }
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('migrate-class-identity failed:', error);
  process.exit(1);
});
