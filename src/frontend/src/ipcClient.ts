import { ipcLink } from 'electron-trpc/renderer';
import { createTRPCProxyClient } from '@trpc/client';
import type { AppRouter } from '../../backend/router';
import { createTRPCReact } from '@trpc/react-query';
import superjson from 'superjson';

export const ipcClient = createTRPCProxyClient<AppRouter>({
  transformer: superjson,
  links: [ipcLink()],
});

export const trpc = createTRPCReact<AppRouter>();
