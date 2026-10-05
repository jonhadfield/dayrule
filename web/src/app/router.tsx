import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router'
import { AreaPage } from '../features/lists/AreaPage'
import {
  InboxPage,
  DonePage,
  BacklogPage,
  TodayPage,
  TrashPage,
  ScheduledPage,
} from '../features/lists/pages'
import { ProjectPage } from '../features/lists/ProjectPage'
import { Home } from './Home'
import { AppError } from './AppError'
import { Layout } from './Layout'

const rootRoute = createRootRoute({
  component: Layout,
  errorComponent: AppError,
})

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: Home }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/inbox',
    component: InboxPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/today',
    component: TodayPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/scheduled',
    component: ScheduledPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/backlog',
    component: BacklogPage,
  }),
  // Ready and Later became Backlog (decision 26); keep old links working.
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/ready',
    beforeLoad: () => {
      throw redirect({ to: '/backlog', replace: true })
    },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/later',
    beforeLoad: () => {
      throw redirect({ to: '/backlog', replace: true })
    },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/done',
    component: DonePage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/trash',
    component: TrashPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/project/$projectId',
    component: ProjectPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/area/$areaId',
    component: AreaPage,
  }),
])

/** Mobile only, and not when reduced motion is asked for. */
const slides = () =>
  window.matchMedia(
    '(max-width: 899px) and (prefers-reduced-motion: no-preference)',
  ).matches

export const router = createRouter({
  routeTree,
  // Mobile pushes into a list and back out to the lists (index.css). Any
  // other navigation, and all of desktop, has no transition: an extra one
  // would only be interrupted by redirects.
  defaultViewTransition: {
    types: ({ fromLocation, toLocation, pathChanged }) => {
      if (!pathChanged || !slides()) return false
      if (toLocation.pathname === '/') return ['back']
      if (fromLocation?.pathname === '/') return ['forward']
      return false
    },
  },
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
