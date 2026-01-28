import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";

const projectConfigSchema = z
  .object({
    name: z.string(),
    path: z.string(),
    templateVars: z.record(z.string(), z.string()).optional(),
    features: z.record(z.string(), z.string()),
  })
  .strict();

const featureChangeSchema = z
  .object({
    renames: z.record(z.string(), z.string()).optional(),
    deletes: z.array(z.string()).optional(),
  })
  .strict();

const featureRuleSchema = z
  .object({
    require: z.enum(["exists"]),
  })
  .strict();

const featureMergeSchema = z
  .object({
    json: z.array(z.string()),
  })
  .strict();

const featureDefinitionSchema = z
  .object({
    domain: z.string(),
    version: z.string(),
    description: z.string(),
    templateRoot: z.string(),
    files: z.array(z.string()),
    changes: z.record(z.string(), featureChangeSchema).optional(),
    fileRules: z.record(z.string(), featureRuleSchema).optional(),
    fileMerge: featureMergeSchema.optional(),
  })
  .strict();

export type ProjectConfig = z.infer<typeof projectConfigSchema>;
export type FeatureDefinition = z.infer<typeof featureDefinitionSchema>;

export function loadProjects(configDir: string): ProjectConfig[] {
  const projectsDir = join(configDir, "projects");
  if (!existsSync(projectsDir)) {
    return [];
  }

  const entries = readdirSync(projectsDir)
    .filter((name: string) => name.endsWith(".json"))
    .map((name: string) => join(projectsDir, name))
    .filter((file: string) => statSync(file).isFile());

  return entries.map((file: string) => {
    const data = readJsonFile(file);
    const parsed = projectConfigSchema.safeParse(data);
    if (!parsed.success) {
      throw new Error(formatZodError(file, parsed.error));
    }
    return parsed.data;
  });
}

export function loadFeatures(configDir: string): FeatureDefinition[] {
  const featuresDir = join(configDir, "features");
  if (!existsSync(featuresDir)) {
    return [];
  }

  const domains = readdirSync(featuresDir)
    .map((name: string) => join(featuresDir, name))
    .filter((dir: string) => statSync(dir).isDirectory());

  const features: FeatureDefinition[] = [];
  for (const domainDir of domains) {
    const domainName = basename(domainDir);
    const versions = readdirSync(domainDir)
      .map((name: string) => join(domainDir, name))
      .filter((dir: string) => statSync(dir).isDirectory());

    for (const versionDir of versions) {
      const versionName = basename(versionDir);
      const featurePath = join(versionDir, "feature.json");
      if (!existsSync(featurePath)) {
        continue;
      }
      const data = readJsonFile(featurePath);
      const parsed = featureDefinitionSchema.safeParse(data);
      if (!parsed.success) {
        throw new Error(formatZodError(featurePath, parsed.error));
      }
      if (parsed.data.domain !== domainName || parsed.data.version !== versionName) {
        throw new Error(
          `Feature definition mismatch in ${featurePath}: expected ${domainName}@${versionName}, got ${parsed.data.domain}@${parsed.data.version}.`,
        );
      }
      features.push(parsed.data);
    }
  }

  return features;
}

function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${filePath}: ${message}`);
  }
}

function formatZodError(filePath: string, error: z.ZodError): string {
  const details = error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "root";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
  return `Invalid config in ${filePath}: ${details}`;
}
