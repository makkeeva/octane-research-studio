import {handleStudio} from '../../../lib/hosted-server';
export const dynamic='force-dynamic';
export async function GET(req:Request){return handleStudio(req);}
export async function POST(req:Request){return handleStudio(req);}
