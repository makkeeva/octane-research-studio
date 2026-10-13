export type Source = {id:string;title:string;url:string;publisher:string;date:string;accessed:string};
export type Claim = {text:string;sourceIds:string[];evidence:string;status:'supported'|'unverified'|'conflict';reviewed:boolean};
export type Report = { title:string;abstract:string;sections:{heading:string;body:string}[];sources:Source[];claims:Claim[];limitations:string;disclosure:string;searchSuggestionsHtml?:string };
export type Doc = {id:string;sourceUrl:string;sourceTitle:string;original:string;language:string;author:string;license:string;report:Report|null;reviewed:boolean;rights:boolean;researchContribution:string;created:string};
