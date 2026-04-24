import fs from "node:fs"
import path, { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import mustache from "mustache"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const SCHEMAS_DIR = path.resolve(__dirname, "../src/schemas")
const SHARED_DIR = path.resolve(__dirname, "../src/shared")
const TEMPLATE_PATH = path.resolve(__dirname, "js-schemas-to-ts.mustache")

interface Import {
  type: string
  file: string
}

interface ModelDto {
  constName?: string
  extends?: MustacheArray<string>
  isEnum?: boolean
  isObject?: boolean
  isUnion?: boolean
  name: string
  properties?: any[]
  typeName?: string
  types?: MustacheArray<string>
  values?: MustacheArray<string>
}

type MustacheArray<T> = MustacheArrayItem<T>[]

interface MustacheArrayItem<T> {
  index: number
  value: T
  last: boolean
}

function parseSchema(schema: any, fileName: string) {
  const imports: Import[] = []
  const models: ModelDto[] = []

  const title = schema.title || path.basename(fileName, ".json")

  // Process definitions
  if (schema.type && schema.title) {
    // root is also schema
    processDefinition(schema.title, schema, imports, models)
  }
  if (schema.definitions) {
    for (const [defName, def] of Object.entries(schema.definitions)) {
      processDefinition(defName, def, imports, models)
    }
  }

  // Process root anyOf/oneOf (union)
  if (schema.anyOf || schema.oneOf) {
    const unionTypes = []
    const items = schema.anyOf || schema.oneOf
    for (const item of items) {
      if (item.$ref) {
        const refName = extractRefName(item.$ref)
        unionTypes.push(refName)
      } else if (item.type === "string" && item.enum) {
        // Inline enum - create a separate enum model
        const enumName: string = `${title}_${unionTypes.length}`
        models.push({
          name: enumName,
          isEnum: true,
          constName: getConstName(enumName),
          typeName: enumName,
          values: toMustacheArray(item.enum),
        })
        unionTypes.push(enumName)
      }
    }
    models.push({
      name: title,
      isUnion: true,
      types: toMustacheArray(unionTypes.filter((t) => t.trim() !== "")),
    })
  }

  return { imports, models }
}

function toMustacheArray<T>(arr: T[]): MustacheArray<T> {
  return arr.map((value, index, array) => {
    return {
      index: index,
      value: value,
      last: index === array.length - 1,
    }
  })
}

function processDefinition(defName: string, def: any, imports: Import[], models: ModelDto[]) {
  if (def.type === "string" && def.enum) {
    models.push({
      name: defName,
      isEnum: true,
      constName: getConstName(defName),
      typeName: defName,
      values: toMustacheArray(def.enum),
    })
  } else if (def.type === "object") {
    const properties = []
    const required = def.required || []
    for (const [propName, propSchema] of Object.entries(def.properties || {})) {
      const type = mapType(propSchema, imports)
      properties.push({
        name: propName,
        type,
        optional: !required.includes(propName),
      })
    }
    models.push({
      name: defName,
      isObject: true,
      properties,
    })
  } else if (def.allOf) {
    // Handle allOf with possible extends
    const baseTypes: string[] = []
    const properties = []
    const required: string[] = []

    for (const element of def.allOf) {
      if (element.$ref) {
        const refName = extractRefName(element.$ref)
        baseTypes.push(refName)
      } else if (element.type === "object") {
        const elemRequired = element.required || []
        for (const [propName, propSchema] of Object.entries(element.properties || {})) {
          const type = mapType(propSchema, imports)
          properties.push({
            name: propName,
            type,
            optional: !elemRequired.includes(propName),
          })
          if (elemRequired.includes(propName) && !required.includes(propName)) {
            required.push(propName)
          }
        }
      }
    }
    // Also include properties from def itself (if any)
    if (def.properties) {
      const defRequired = def.required || []
      for (const [propName, propSchema] of Object.entries(def.properties)) {
        const type = mapType(propSchema, imports)
        properties.push({
          name: propName,
          type,
          optional: !defRequired.includes(propName),
        })
      }
    }
    models.push({
      name: defName,
      isObject: true,
      extends: baseTypes.length > 0 ? toMustacheArray(baseTypes) : undefined,
      properties,
    })
  } else if (def.oneOf || def.anyOf) {
    const unionTypes = []
    const items = def.oneOf || def.anyOf
    for (const item of items) {
      if (item.$ref) {
        const refName = extractRefName(item.$ref)
        unionTypes.push(refName)
      } else if (item.type === "string" && item.const) {
        // literal type
        unionTypes.push(`"${item.const}"`)
      }
    }
    models.push({
      name: defName,
      isUnion: true,
      types: toMustacheArray(unionTypes.filter((t) => t.trim() !== "")),
    })
  }
}

function mapType(schema: any, imports: Import[]) {
  if (schema.$ref) {
    const refName = extractRefName(schema.$ref)
    // Check if reference is external
    if (schema.$ref.includes(".json#")) {
      const externalFile = `${schema.$ref.split(".json#")[0]}.json`
      const importType = refName
      const importFile = externalFile.replace(".json", "")
      // Add import if not already present
      if (!imports.some((i) => i.type === importType && i.file === importFile)) {
        imports.push({ type: importType, file: importFile })
      }
      return importType
    }
    return refName
  }
  if (schema.type === "string") {
    if (schema.enum) {
      // inline enum - we should generate a separate enum, but for simplicity return string
      return "string"
    }
    return "string"
  }
  if (schema.type === "number") return "number"
  if (schema.type === "integer") return "number"
  if (schema.type === "boolean") return "boolean"
  if (schema.type === "array") {
    const items: string = schema.items ? mapType(schema.items, imports) : "any"
    return `${items}[]`
  }
  if (schema.type === "object") {
    // anonymous object - we could generate inline interface, but for simplicity return Record
    return "Record<string, any>"
  }
  if (schema.const) {
    return `"${schema.const}"`
  }
  return "any"
}

function extractRefName(ref: string) {
  // #/definitions/WizardInputField -> WizardInputField
  // plan-node-types.json#/ -> PlanNodeType
  // plan-edge-types.json#/ -> PlanEdgeType
  if (ref.includes(".json#")) {
    // external reference
    const filePart = ref.split(".json#")[0]
    // map file name to type name
    const mapping: Record<string, string> = {
      "plan-node-types": "PlanNodeType",
      "plan-edge-types": "PlanEdgeType",
    }
    return mapping[filePart] || filePart
  }
  const parts = ref.split("/")
  return parts[parts.length - 1] || parts[parts.length - 2] || "Unknown"
}

function getConstName(typeName: string) {
  // Convert PascalCase to UPPER_SNAKE_CASE
  // Simple heuristic: split by capital letters and join with underscores
  const words = typeName.replace(/([a-z])([A-Z])/g, "$1_$2").split("_")
  return `${words.join("_").toUpperCase()}_VALUES`
}

function generateTypeScript(data: any, template: any) {
  return mustache.render(template, data)
}

function main() {
  try {
    console.info("Starting schema generation...")
    console.info(`Schemas directory: ${SCHEMAS_DIR}`)
    console.info(`Shared directory: ${SHARED_DIR}`)
    const template = fs.readFileSync(TEMPLATE_PATH, "utf-8")
    const files = fs.readdirSync(SCHEMAS_DIR).filter((f) => f.endsWith(".json"))
    console.info(`Found ${files.length} schema files: ${files.join(", ")}`)

    for (const file of files) {
      console.info(`\nProcessing ${file}...`)
      const schemaPath = path.resolve(SCHEMAS_DIR, file)
      const schemaContent = fs.readFileSync(schemaPath, "utf-8")
      const schema = JSON.parse(schemaContent)
      const data = parseSchema(schema, file)
      console.info("Parsed file", file)
      const output = generateTypeScript(data, template)
      const outputFileName = `${path.basename(file, ".json")}.ts`
      const outputPath = path.resolve(SHARED_DIR, outputFileName)
      fs.writeFileSync(outputPath, output)
      console.info(`Generated ${outputPath}`)
    }
    console.info("\nSchema generation completed.")
  } catch (error) {
    console.info("Error during schema generation:", error)
    process.exit(1)
  }
}

main()
