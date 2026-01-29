import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";

const projectConfigSchema = z
  .object({
    name: z.string(),
    path: z.string(),
    templateVars: z.record(z.string(), z.string()).optional(),
    features: z.array(z.string()),
  })
  .strict();

const featureDefinitionSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    files: z.array(z.string()),
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

  const featureDirs = readdirSync(featuresDir)
    .map((name: string) => join(featuresDir, name))
    .filter((dir: string) => statSync(dir).isDirectory());

  return featureDirs.flatMap((featureDir) => {
    const featureName = basename(featureDir);
    const featurePath = join(featureDir, "feature.json");
    if (!existsSync(featurePath)) {
      return [];
    }
    const data = readJsonFile(featurePath);
    const parsed = featureDefinitionSchema.safeParse(data);
    if (!parsed.success) {
      throw new Error(formatZodError(featurePath, parsed.error));
    }
    if (parsed.data.name !== featureName) {
      throw new Error(
        `Feature definition mismatch in ${featurePath}: expected ${featureName}, got ${parsed.data.name}.`,
      );
    }
    return [parsed.data];
  });
}

export function loadFeature(configDir: string, name: string): FeatureDefinition {
  const feature = loadFeatures(configDir).find((entry) => entry.name === name);
  if (!feature) {
    throw new Error(`Feature not found: ${name}`);
  }
  return feature;
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
