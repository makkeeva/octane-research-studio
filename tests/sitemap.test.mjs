import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseSitemapLocs,articleUrlsFromLocs,selectNewArticles} from '../dist/test-library.mjs';

const indexXml=`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
 <sitemap><loc>https://octane.rent/post-sitemap.xml</loc></sitemap>
 <sitemap><loc>https://octane.rent/page-sitemap.xml</loc></sitemap>
</sitemapindex>`;

const urlsetXml=`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
 <url><loc>https://octane.rent/blog/sedan-car-rental-dubai/</loc></url>
 <url><loc>https://octane.rent/blog/2026-toyota-fortuner-uae/</loc></url>
 <url><loc>https://octane.rent/blog/</loc></url>
 <url><loc>https://octane.rent/blog/page/2/</loc></url>
 <url><loc>https://octane.rent/blog/category/cars/</loc></url>
 <url><loc>https://octane.rent/about/</loc></url>
 <url><loc>https://example.com/blog/other/</loc></url>
</urlset>`;

test('parseSitemapLocs distinguishes a sitemap index from a urlset',()=>{
 const index=parseSitemapLocs(indexXml);
 assert.equal(index.isIndex,true);
 assert.deepEqual(index.locs,['https://octane.rent/post-sitemap.xml','https://octane.rent/page-sitemap.xml']);
 const set=parseSitemapLocs(urlsetXml);
 assert.equal(set.isIndex,false);
 assert.equal(set.locs.length,7);
});

test('articleUrlsFromLocs keeps only octane blog articles, dropping index, pagination, categories and foreign hosts',()=>{
 const articles=articleUrlsFromLocs(parseSitemapLocs(urlsetXml).locs);
 assert.deepEqual(articles,[
  'https://octane.rent/blog/sedan-car-rental-dubai/',
  'https://octane.rent/blog/2026-toyota-fortuner-uae/'
 ]);
});

test('selectNewArticles skips already-imported URLs and respects the cap',()=>{
 const all=[
  'https://octane.rent/blog/a/',
  'https://octane.rent/blog/b/',
  'https://octane.rent/blog/c/',
  'https://octane.rent/blog/d/'
 ];
 const existing=new Set(['https://octane.rent/blog/b/']);
 assert.deepEqual(selectNewArticles(all,existing,2),['https://octane.rent/blog/a/','https://octane.rent/blog/c/']);
 assert.deepEqual(selectNewArticles(all,[],10),all);
 assert.deepEqual(selectNewArticles(all,all,3),[]);
});
