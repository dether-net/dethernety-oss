import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import * as path from 'path';
import { printableKeys } from '../common/utils/display-text';
import { readRegularFile } from '../common/utils/read-regular-file';
import { BRAND_JSON_MAX_BYTES, Brand, LOGO_MAX_BYTES, LogoType, parseBrandJson, sniffLogo } from './brand-file';

/** The brand as the browser receives it in `/config`. */
export interface BrandingConfig {
  name: string;
  url?: string;
  footer?: string;
  /** The logo at its content-addressed URL; the hash changes when the logo does. */
  logoUrl?: string;
  logoWidth?: number;
  logoHeight?: number;
}

/** The validated logo, served from memory. */
export interface BrandLogo {
  readonly hash: string;
  readonly type: LogoType;
  readonly width: number;
  readonly height: number;
  readonly bytes: Buffer;
}

interface LoadedBrand {
  brand: Brand;
  logo?: BrandLogo;
}

const brandLogoUrl = (hash: string) => `/branding/logo/${hash}`;

/**
 * The installation's brand: read once at start-up from the file `BRANDING_FILE` names, and held in
 * memory. Whoever runs the installation edits the file; a change applies on restart. A missing or bad
 * file is logged and leaves the platform unbranded: nothing here throws, because a refusal at start-up
 * would stop the platform for a cosmetic file.
 */
@Injectable()
export class BrandingService implements OnModuleInit {
  private readonly logger = new Logger(BrandingService.name);
  private loaded: LoadedBrand | null = null;

  async onModuleInit(): Promise<void> {
    await this.load(process.env.BRANDING_FILE);
  }

  /** Reads the brand file; exposed for tests. Always resolves. */
  async load(brandingFile: string | undefined): Promise<void> {
    this.loaded = null;
    if (!brandingFile || brandingFile.trim() === '') return;
    const file = path.resolve(brandingFile.trim());
    try {
      this.loaded = await this.read(file);
    } catch (error) {
      this.logger.warn(
        `Brand file ${file} could not be read (${(error as NodeJS.ErrnoException).code ?? (error as Error).message}); reports are unbranded`,
      );
      this.loaded = null;
    }
  }

  private async read(file: string): Promise<LoadedBrand | null> {
    const json = await readRegularFile(file, BRAND_JSON_MAX_BYTES);
    if (json.kind === 'absent') {
      // Not a warning: an installation that keeps the brand in a mounted folder sets BRANDING_FILE before it has one.
      this.logger.log(`Brand file ${file} does not exist; reports are unbranded`);
      return null;
    }
    if (json.kind === 'refused') {
      this.logger.warn(`Brand file ${file} refused: ${json.reason}; reports are unbranded`);
      return null;
    }
    const parsed = parseBrandJson(json.bytes.toString('utf8'));
    if (parsed.kind === 'refused') {
      this.logger.warn(`Brand file ${file} refused: ${parsed.reason}; reports are unbranded`);
      return null;
    }
    if (parsed.ignoredKeys.length) {
      this.logger.log(`Brand file ${file}: ignoring unknown keys ${printableKeys(parsed.ignoredKeys)}`);
    }
    if (parsed.logoProblem) {
      this.logger.warn(`Brand file ${file}: ${parsed.logoProblem}; reports carry no logo`);
    }
    const { brand } = parsed;
    const logo = brand.logo ? await this.readLogo(path.join(path.dirname(file), brand.logo)) : undefined;
    this.logger.log(`Brand loaded from ${file}${logo ? ' with a logo' : ''}`);
    return { brand, logo };
  }

  /** The logo, or undefined (logged) when it cannot be used; the rest of the brand still applies. */
  private async readLogo(file: string): Promise<BrandLogo | undefined> {
    try {
      const read = await readRegularFile(file, LOGO_MAX_BYTES);
      if (read.kind === 'absent') {
        this.logger.warn(`Brand logo ${file} does not exist; reports carry no logo`);
        return undefined;
      }
      if (read.kind === 'refused') {
        this.logger.warn(`Brand logo ${file} refused: ${read.reason}; reports carry no logo`);
        return undefined;
      }
      const sniff = sniffLogo(read.bytes);
      if (sniff.kind === 'refused') {
        this.logger.warn(`Brand logo ${file} refused: ${sniff.reason}; reports carry no logo`);
        return undefined;
      }
      return Object.freeze({
        hash: createHash('sha256').update(read.bytes).digest('hex'),
        type: sniff.type,
        width: sniff.width,
        height: sniff.height,
        bytes: read.bytes,
      });
    } catch (error) {
      this.logger.warn(
        `Brand logo ${file} could not be read (${(error as NodeJS.ErrnoException).code ?? (error as Error).message}); reports carry no logo`,
      );
      return undefined;
    }
  }

  /** What `/config` carries: null when the installation is unbranded. */
  publicConfig(): BrandingConfig | null {
    if (!this.loaded) return null;
    const { brand, logo } = this.loaded;
    return {
      name: brand.name,
      ...(brand.url ? { url: brand.url } : {}),
      ...(brand.footer ? { footer: brand.footer } : {}),
      ...(logo ? { logoUrl: brandLogoUrl(logo.hash), logoWidth: logo.width, logoHeight: logo.height } : {}),
    };
  }

  /** The current logo, only when `hash` names it exactly. */
  logo(hash: string): BrandLogo | null {
    const logo = this.loaded?.logo;
    return logo && logo.hash === hash ? logo : null;
  }
}
