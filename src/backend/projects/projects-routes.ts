import z from "zod"
import { exportProjectAsTemplateOptionsSchema } from "../../shared/export-as-template-options.js"
import { PROJECT_CREATE_OPTIONS_SCHEMA } from "../../shared/project-create-options.js"
import type { SettingsTypes } from "../../shared/settings.js"
import type { RouteBuilder } from "../router.js"
import { createProject } from "./create-project.js"
import { exportProjectAsTemplate } from "./export-project-as-template.js"
import { getProjectsFolder, hasProjectWithName, listProjectFiles } from "./project-folder.js"
import { applyProjectSettings, getProjectSettings } from "./project-settings.js"
import { closeProject, getProjectStatus, openProject } from "./project-state.js"
import { findTemplates, getTemplate, getTemplateFolders } from "./project-templates.js"
import { deleteRecentProject, getRecentProjects } from "./recent-projects.js"
import { analyzeTemplateUpdate, applyTemplateUpdate } from "./template-update.js"

export function buildProjectRoutes(t: RouteBuilder) {
  return t.router({
    applyProjectSettings: t.procedure
      .input((v) => v as Partial<SettingsTypes>)
      .mutation(({ input }) => applyProjectSettings(input)),
    status: t.procedure.query(() => getProjectStatus()),
    close: t.procedure.mutation(() => closeProject()),
    open: t.procedure.input(z.string()).mutation(({ input }) => openProject(input)),
    recent: t.procedure.query(() => getRecentProjects()),
    recentDelete: t.procedure.input(z.string()).mutation(({ input }) => deleteRecentProject(input)),
    files: t.procedure.query(() => listProjectFiles()),
    hasProjectWithName: t.procedure.input(z.string()).mutation(({ input }) => hasProjectWithName(input)),
    create: t.procedure.input(PROJECT_CREATE_OPTIONS_SCHEMA).mutation(({ input }) => createProject(input)),
    exportProjectAsTemplate: t.procedure
      .input(exportProjectAsTemplateOptionsSchema)
      .mutation(({ input }) => exportProjectAsTemplate(input)),
    findTemplates: t.procedure.query(() => findTemplates()),
    getProjectSettings: t.procedure.input(z.string()).mutation(({ input }) => getProjectSettings(input)),
    getProjectsFolder: t.procedure.query(() => getProjectsFolder()),
    getTemplate: t.procedure.input(z.string()).query(({ input }) => getTemplate(input)),
    getTemplatesFolders: t.procedure.query(() => getTemplateFolders()),
    analyzeTemplateUpdate: t.procedure.query(() => analyzeTemplateUpdate()),
    applyTemplateUpdate: t.procedure.mutation(() => applyTemplateUpdate()),
  })
}
