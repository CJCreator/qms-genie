/* eslint-disable */

// @ts-nocheck

import { Route as rootRouteImport } from './routes/__root'
import { Route as LoginRouteImport } from './routes/login'
import { Route as AuthenticatedRouteImport } from './routes/_authenticated'
import { Route as AuthenticatedIndexRouteImport } from './routes/_authenticated.index'
import { Route as AuthenticatedTemplatesRouteImport } from './routes/_authenticated.templates'
import { Route as AuthenticatedProjectsIdRouteImport } from './routes/_authenticated.projects.$id'

const LoginRoute = LoginRouteImport.update({
  id: '/login', path: '/login', getParentRoute: () => rootRouteImport,
} as any)
const AuthenticatedRoute = AuthenticatedRouteImport.update({
  id: '/_authenticated', getParentRoute: () => rootRouteImport,
} as any)
const AuthenticatedIndexRoute = AuthenticatedIndexRouteImport.update({
  id: '/', path: '/', getParentRoute: () => AuthenticatedRoute,
} as any)
const AuthenticatedTemplatesRoute = AuthenticatedTemplatesRouteImport.update({
  id: '/templates', path: '/templates', getParentRoute: () => AuthenticatedRoute,
} as any)
const AuthenticatedProjectsIdRoute = AuthenticatedProjectsIdRouteImport.update({
  id: '/projects/$id', path: '/projects/$id', getParentRoute: () => AuthenticatedRoute,
} as any)

export interface FileRoutesByFullPath {
  '/': typeof AuthenticatedIndexRoute
  '/login': typeof LoginRoute
  '/templates': typeof AuthenticatedTemplatesRoute
  '/projects/$id': typeof AuthenticatedProjectsIdRoute
}
export interface FileRoutesByTo extends FileRoutesByFullPath {}
export interface FileRoutesById {
  __root__: typeof rootRouteImport
  '/login': typeof LoginRoute
  '/_authenticated': typeof AuthenticatedRoute
  '/_authenticated/': typeof AuthenticatedIndexRoute
  '/_authenticated/templates': typeof AuthenticatedTemplatesRoute
  '/_authenticated/projects/$id': typeof AuthenticatedProjectsIdRoute
}
export interface FileRouteTypes {
  fileRoutesByFullPath: FileRoutesByFullPath
  fullPaths: '/' | '/login' | '/templates' | '/projects/$id'
  fileRoutesByTo: FileRoutesByTo
  to: '/' | '/login' | '/templates' | '/projects/$id'
  id: '__root__' | '/login' | '/_authenticated' | '/_authenticated/' | '/_authenticated/templates' | '/_authenticated/projects/$id'
  fileRoutesById: FileRoutesById
}
export interface RootRouteChildren {
  LoginRoute: typeof LoginRoute
  AuthenticatedRoute: typeof AuthenticatedRouteWithChildren
}

declare module '@tanstack/react-router' {
  interface FileRoutesByPath {
    '/login': {
      id: '/login'; path: '/login'; fullPath: '/login'
      preLoaderRoute: typeof LoginRouteImport; parentRoute: typeof rootRouteImport
    }
    '/_authenticated': {
      id: '/_authenticated'; path: ''; fullPath: ''
      preLoaderRoute: typeof AuthenticatedRouteImport; parentRoute: typeof rootRouteImport
    }
    '/_authenticated/': {
      id: '/_authenticated/'; path: '/'; fullPath: '/'
      preLoaderRoute: typeof AuthenticatedIndexRouteImport; parentRoute: typeof AuthenticatedRoute
    }
    '/_authenticated/templates': {
      id: '/_authenticated/templates'; path: '/templates'; fullPath: '/templates'
      preLoaderRoute: typeof AuthenticatedTemplatesRouteImport; parentRoute: typeof AuthenticatedRoute
    }
    '/_authenticated/projects/$id': {
      id: '/_authenticated/projects/$id'; path: '/projects/$id'; fullPath: '/projects/$id'
      preLoaderRoute: typeof AuthenticatedProjectsIdRouteImport; parentRoute: typeof AuthenticatedRoute
    }
  }
}

interface AuthenticatedRouteChildren {
  AuthenticatedIndexRoute: typeof AuthenticatedIndexRoute
  AuthenticatedTemplatesRoute: typeof AuthenticatedTemplatesRoute
  AuthenticatedProjectsIdRoute: typeof AuthenticatedProjectsIdRoute
}
const AuthenticatedRouteChildrenValue: AuthenticatedRouteChildren = {
  AuthenticatedIndexRoute, AuthenticatedTemplatesRoute, AuthenticatedProjectsIdRoute,
}
const AuthenticatedRouteWithChildren = AuthenticatedRoute._addFileChildren(AuthenticatedRouteChildrenValue)

const rootRouteChildren: RootRouteChildren = {
  LoginRoute, AuthenticatedRoute: AuthenticatedRouteWithChildren,
}
export const routeTree = rootRouteImport
  ._addFileChildren(rootRouteChildren)
  ._addFileTypes<FileRouteTypes>()
