import type {ReactNode} from 'react';
export const metadata={title:'Octane Research Studio',description:'Приватная студия аналитических отчётов с постоянным хранением.'};
export default function RootLayout({children}:{children:ReactNode}){return <html lang="ru"><body>{children}</body></html>;}
