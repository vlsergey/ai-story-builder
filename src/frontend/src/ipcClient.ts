import { ipcLink } from 'electron-trpc/renderer';
import { createTRPCProxyClient } from '@trpc/client';
import type { AppRouter } from '../../backend/router'; // Импорт ТИПА
import { createTRPCReact } from '@trpc/react-query';

export const ipcClient = createTRPCProxyClient<AppRouter>({
  links: [ipcLink()],
});

export const trpc = createTRPCReact<AppRouter>();
