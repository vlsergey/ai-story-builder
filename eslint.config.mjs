import tsParser from "@typescript-eslint/parser"

export default [
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      sourceType: "module",
    },
    plugins: {
      // Описываем наш локальный плагин прямо здесь
      "local-logic": {
        rules: {
          "no-trpc-obj-in-deps": {
            meta: { type: "problem" },
            create(context) {
              return {
                // Target common React hooks that take a dependency array
                "CallExpression[callee.name=/^(useCallback|useEffect|useMemo)$/]": (node) => {
                  // The dependency array is typically the second argument
                  const depsArray = node.arguments.find((arg) => arg.type === "ArrayExpression")
                  if (!depsArray) return

                  depsArray.elements.forEach((element) => {
                    if (element?.type !== "Identifier") return

                    // Use ESLint's scope analysis to find where the variable was defined
                    const scope = context.sourceCode.getScope(node)
                    const variable =
                      scope.variables.find((v) => v.name === element.name) ||
                      scope.upper?.variables.find((v) => v.name === element.name)

                    const definition = variable?.defs?.[0]
                    if (!definition) return

                    // If the variable is part of a destructuring pattern (Object or Array),
                    // it means we are already using a specific property (like 'data'), not the raw object.
                    const parentType = definition.name.parent?.type
                    if (parentType === "Property" || parentType === "ObjectPattern" || parentType === "ArrayPattern") {
                      return
                    }

                    // If it's a direct assignment (const x = useQuery()), check the initializer
                    const initializer = definition.node.init

                    if (initializer?.type === "CallExpression") {
                      const initCode = context.sourceCode.getText(initializer)
                      // Flag if the initializer looks like a tRPC or TanStack query/mutation
                      if (initCode.includes(".useMutation") || initCode.includes(".useQuery")) {
                        context.report({
                          node: element,
                          message:
                            `❌ ERROR: '${element.name}' is a raw tRPC/Query object. ` +
                            `It is not stable and must not be passed as dependency to useCallback, useEffect or useMemo`,
                        })
                      }
                    }
                  })
                },
              }
            },
          },
        },
      },
    },
    rules: {
      "local-logic/no-trpc-obj-in-deps": "error",
    },
  },
]
