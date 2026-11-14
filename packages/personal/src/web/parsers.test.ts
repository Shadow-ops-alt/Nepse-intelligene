import { describe, expect, it } from "vitest";
import {
  parseCompanyProfile as parseMerolaganiCompany,
  parseCorporateActions,
  parseFloorsheet,
  parseFloorsheetPager,
  parseIndexRows,
  parseNews as parseMerolaganiNews,
} from "./merolagani";
import {
  parseCompanyProfile as parseShareSansarCompany,
  parseIndexHistoryJson,
  parseIndexOptions,
  parseMarketSummary,
  parseMutualFundNavJson,
  parseNews as parseShareSansarNews,
  parseTodaySharePrice,
  parseUpcomingIssuesJson,
} from "./sharesansar";

describe("ShareSansar parsers", () => {
  it("reads company profile fields without guessing missing values", () => {
    const html = `
      <h1>Nabil Bank Limited (NABIL)</h1>
      <div id="company-info">
        <table>
          <tr><td class="text-bold">Sector</td><td>Commercial Banks</td></tr>
          <tr><td class="text-bold">Listed Shares</td><td>284,098,483</td></tr>
          <tr><td class="text-bold">Paid Up</td><td>100</td></tr>
          <tr><td class="text-bold">Total Paid Up Value</td><td>28,409,848,300</td></tr>
          <tr><td class="text-bold">Operation Date</td><td>1998-01-01</td></tr>
          <tr><td class="text-bold">Share Registrar</td><td>Nabil Bank Ltd.</td></tr>
          <tr><td class="text-bold">Address</td><td>Kathmandu</td></tr>
          <tr><td class="text-bold">Phone Number</td><td>01-1234567</td></tr>
          <tr><td class="text-bold">Email</td><td>info@example.com</td></tr>
          <tr><td class="text-bold">Website</td><td><a target="_blank" href="https://example.com">example.com</a></td></tr>
        </table>
      </div>`;
    const profile = parseShareSansarCompany(
      html,
      "nabil",
      "https://www.sharesansar.com/company/nabil",
    );
    expect(profile).toMatchObject({
      symbol: "NABIL",
      name: "Nabil Bank Limited",
      sector: "Commercial Banks",
      sharesOutstanding: 284098483,
      paidUpValue: 100,
      totalPaidUpValue: 28409848300,
      operationDate: "1998-01-01",
      registrar: "Nabil Bank Ltd.",
      website: "https://example.com/",
    });
  });

  it("reads the current market summary", () => {
    const html = `
      <div id="market_symmary_data">
        <h5>As of : 2026-11-13</h5>
        <table>
          <tr><td>Total Turnovers</td><td>3,054,274,725.06</td></tr>
          <tr><td>Total Traded Shares</td><td>7,844,267</td></tr>
          <tr><td>Total Transactions</td><td>31,323</td></tr>
          <tr><td>Total Scrips Traded</td><td>335</td></tr>
          <tr><td>Total Market Cap</td><td>4.2 Trillion</td></tr>
        </table>
      </div>`;
    const summary = parseMarketSummary(html);
    expect(summary).toMatchObject({
      asOfDate: "2026-11-13",
      turnover: 3054274725.06,
      sharesTraded: 7844267,
      transactions: 31323,
      scripsTraded: 335,
    });
  });

  it("reads today's price table and rejects invalid OHLC", () => {
    const cells = [
      "1",
      "NABIL",
      "Nabil Bank Limited",
      "540",
      "552",
      "538",
      "549",
      "549",
      "0",
      "0",
      "548",
      "1,000",
      "550",
      "549,000",
      "12",
      "0",
      "0",
      "-0.18",
    ]
      .map((value) => `<td>${value}</td>`)
      .join("");
    const invalid = [
      "2",
      "BAD",
      "Bad Bank",
      "540",
      "530",
      "538",
      "549",
      "549",
      "0",
      "0",
      "548",
      "1,000",
      "550",
      "549,000",
      "12",
      "0",
      "0",
      "-0.18",
    ]
      .map((value) => `<td>${value}</td>`)
      .join("");
    const rows = parseTodaySharePrice(
      `<table><tbody><tr>${cells}</tr><tr>${invalid}</tr></tbody></table>`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      symbol: "NABIL",
      open: 540,
      high: 552,
      low: 538,
      close: 549,
      previousClose: 550,
      volume: 1000,
      turnover: 549000,
      trades: 12,
      vwap: 548,
      perChange: -0.18,
    });
  });

  it("maps index options to stable symbols", () => {
    const definitions = parseIndexOptions(`
      <select id="index">
        <option value="12">NEPSE Index</option>
        <option value="1">Banking SubIndex</option>
        <option value="99">Some New Index</option>
      </select>`);
    expect(definitions).toEqual([
      { id: 12, name: "NEPSE Index", symbol: "NEPSE", isSector: false },
      { id: 1, name: "Banking SubIndex", symbol: "BANKING", isSector: true },
      {
        id: 99,
        name: "Some New Index",
        symbol: "SOME_NEW_INDEX",
        isSector: true,
      },
    ]);
  });

  it("parses index history, sorts it and drops malformed rows", () => {
    const rows = parseIndexHistoryJson(
      JSON.stringify({
        data: [
          {
            published_date: "2026-11-13",
            open: "2649.6",
            high: "2656.23",
            low: "2639.67",
            current: "2648.89",
            change_: "-6.32",
            per_change: "-0.23",
            turnover: "3054274725.05",
          },
          {
            published_date: "2026-11-12",
            open: "2650.11",
            high: "2661.44",
            low: "2647.11",
            current: "2655.22",
            change_: "5.11",
          },
          {
            published_date: "2026-11-11",
            open: "2600",
            high: "2590",
            low: "2610",
            current: "2600",
          },
        ],
      }),
      12,
    );
    expect(rows.map((row) => row.date)).toEqual([
      "2026-11-12",
      "2026-11-13",
    ]);
    expect(rows[1]).toMatchObject({
      indexId: 12,
      close: 2648.89,
      change: -6.32,
      changePercent: -0.23,
    });
  });

  it("reads mutual-fund NAV rows", () => {
    const rows = parseMutualFundNavJson(
      JSON.stringify({
        data: [
          {
            symbol: "NGF",
            companyname: "Nabil Growth Fund",
            fund_size: "750723900",
            daily_nav_price: "9.94",
            daily_date: "2026-11-13",
            weekly_nav_price: "9.94",
            weekly_date: "2026-11-06",
            monthly_nav_price: "10.01",
            monthly_date: "Ashwin 2083",
            close: "9.1",
            published_date: "2026-11-13",
            prem_dis: "-8.45",
          },
        ],
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      symbol: "NGF",
      name: "Nabil Growth Fund",
      fundSize: 750723900,
      dailyNav: 9.94,
      dailyNavDate: "2026-11-13",
      weeklyNav: 9.94,
      monthlyNav: 10.01,
      close: 9.1,
      publishedDate: "2026-11-13",
      premiumDiscountPercent: -8.45,
    });
  });

  it("reads the upcoming issue list", () => {
    const rows = parseUpcomingIssuesJson(
      JSON.stringify({
        data: [
          {
            company: {
              symbol: "<a>tenx</a>",
              companyname: "Tenx Hydro Holding Limited",
            },
            total_units: "800,000",
            amount: "80,000,000",
            application_date: "2026-10-28",
            date_sebon: "2026-10-20",
            issue_manager: "Muktinath Capital",
            remark: "Closed",
          },
        ],
      }),
      "ipo",
    );
    expect(rows).toEqual([
      {
        symbol: "TENX",
        companyName: "Tenx Hydro Holding Limited",
        type: "ipo",
        units: 800000,
        amount: 80000000,
        applicationDate: "2026-10-28",
        sebonDate: "2026-10-20",
        issueManager: "Muktinath Capital",
        remark: "Closed",
      },
    ]);
  });

  it("reads ShareSansar news and ignores duplicate ids", () => {
    const item = `
      <div class="featured-news-list">
        <a href="/newsdetail/132515" title="Headline one"><h4>Headline one</h4></a>
        <span class="text-org">2026-11-13</span>
      </div>`;
    const items = parseShareSansarNews(item + item);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      id: "132515",
      title: "Headline one",
      url: "https://www.sharesansar.com/newsdetail/132515",
      publishedAt: "2026-11-13T12:00:00+05:45",
    });
  });
});

describe("Merolagani parsers", () => {
  it("reads the company profile and displayed ratios", () => {
    const html = `
      <table>
        <tr><th>Company Name</th><td>Nabil Bank Limited</td></tr>
        <tr><th>Sector</th><td>Commercial Banks</td></tr>
        <tr><th>Shares Outstanding</th><td>284,098,468.5</td></tr>
        <tr><th>Paidup Value</th><td>100</td></tr>
        <tr><th>Total Paidup Value</th><td>28,409,846,850</td></tr>
        <tr><th>Market Price</th><td>549</td></tr>
        <tr><th>Market Capitalization</th><td>155,970,059,206.5</td></tr>
        <tr><th>EPS</th><td>33.89 (FY:083-084, Q:1)</td></tr>
        <tr><th>P/E Ratio</th><td>16.2</td></tr>
        <tr><th>Book Value</th><td>233.9</td></tr>
        <tr><th>PBV</th><td>2.35</td></tr>
        <tr><th>% Dividend</th><td>10.8 (FY:082-083)</td></tr>
        <tr><th>% Bonus</th><td>5 (FY:082-083)</td></tr>
        <tr><th>52 Weeks High - Low</th><td>581 - 485</td></tr>
        <tr><th>Last Traded On</th><td>2026/11/13 15:00:00</td></tr>
      </table>`;
    const profile = parseMerolaganiCompany(
      html,
      "nabil",
      "https://merolagani.com/CompanyDetail.aspx?symbol=NABIL",
    );
    expect(profile).toMatchObject({
      symbol: "NABIL",
      name: "Nabil Bank Limited",
      sharesOutstanding: 284098468.5,
      eps: 33.89,
      epsFiscalYear: "083-084",
      epsQuarter: 1,
      peRatio: 16.2,
      bookValue: 233.9,
      pbv: 2.35,
      dividendPercent: 10.8,
      bonusPercent: 5,
      fiftyTwoWeekHigh: 581,
      fiftyTwoWeekLow: 485,
      lastTradedAt: "2026-11-13T15:00:00+05:45",
    });
  });

  it("reads dividend, bonus and right histories", () => {
    const html = `
      <div id="dividend-panel"><table>
        <tr><td>2082-083</td><td>10.8</td><td>FY 082-083</td></tr>
      </table></div>
      <div id="bonus-panel"><table>
        <tr><td>2082-083</td><td>5</td><td>FY 082-083</td></tr>
      </table></div>
      <div id="right-panel"><table>
        <tr><td>2081-082</td><td>2</td><td>FY 081-082</td></tr>
      </table></div>`;
    const actions = parseCorporateActions(
      html,
      "nabil",
      "https://merolagani.com/CompanyDetail.aspx?symbol=NABIL",
    );
    expect(actions).toEqual([
      {
        symbol: "NABIL",
        type: "cashDividend",
        percent: 10.8,
        fiscalYear: "082-083",
        sourceUrl: "https://merolagani.com/CompanyDetail.aspx?symbol=NABIL",
      },
      {
        symbol: "NABIL",
        type: "bonus",
        percent: 5,
        fiscalYear: "082-083",
        sourceUrl: "https://merolagani.com/CompanyDetail.aspx?symbol=NABIL",
      },
      {
        symbol: "NABIL",
        type: "right",
        percent: 2,
        fiscalYear: "081-082",
        sourceUrl: "https://merolagani.com/CompanyDetail.aspx?symbol=NABIL",
      },
    ]);
  });

  it("reads the NEPSE index history table", () => {
    const rows = parseIndexRows(`
      <table><tbody>
        <tr><td>1</td><td>2026-11-13</td><td>2,648.89</td><td>-6.32</td><td>-0.23</td></tr>
        <tr><td>2</td><td>2026-11-12</td><td>2,655.22</td><td>5.11</td><td>0.19</td></tr>
      </tbody></table>`);
    expect(rows.map((row) => row.value)).toEqual([2655.22, 2648.89]);
  });

  it("reads floorsheet trades, derives the date and rejects bad rows", () => {
    const trades = parseFloorsheet(`
      <table class="sortable"><tbody>
        <tr>
          <td>1</td><td>2026111305011775</td><td>AHL</td><td>62</td>
          <td>40</td><td>10</td><td>400</td><td>4,000</td>
        </tr>
        <tr>
          <td>2</td><td>2026111305011776</td><td>BAD</td><td>62</td>
          <td>40</td><td>0</td><td>400</td><td>0</td>
        </tr>
      </tbody></table>`);
    expect(trades).toEqual([
      {
        contractId: "2026111305011775",
        symbol: "AHL",
        buyerBroker: "62",
        sellerBroker: "40",
        quantity: 10,
        rate: 400,
        amount: 4000,
        date: "2026-11-13",
      },
    ]);
  });

  it("reads the ASP.NET floorsheet pager", () => {
    const pager = parseFloorsheetPager(`
      <div class="pagging">Total pages: 63</div>
      <input type="hidden" name="__VIEWSTATE" value="abc" />
      <input type="hidden" name="ctl00$ContentPlaceHolder1$PagerControl1$hdnCurrentPage" value="1" />
      <input type="hidden" name="ctl00$ContentPlaceHolder1$PagerControl1$btnPaging" value="" />`);
    expect(pager.totalPages).toBe(63);
    expect(pager.currentPage).toBe(1);
    expect(pager.currentPageField).toBe(
      "ctl00$ContentPlaceHolder1$PagerControl1$hdnCurrentPage",
    );
    expect(pager.pagingButtonField).toBe(
      "ctl00$ContentPlaceHolder1$PagerControl1$btnPaging",
    );
    expect(pager.fields.__VIEWSTATE).toBe("abc");
  });

  it("reads Merolagani news with Nepal-time timestamps", () => {
    const items = parseMerolaganiNews(`
      <div class="media-news">
        <h4><a href="/NewsDetail.aspx?newsID=132515">Headline two</a></h4>
        <span class="media-label">Nov 13, 2026 04:04 PM</span>
      </div>`);
    expect(items).toEqual([
      {
        id: "132515",
        title: "Headline two",
        url: "https://merolagani.com/NewsDetail.aspx?newsID=132515",
        publishedAt: "2026-11-13T16:04:00+05:45",
      },
    ]);
  });
});
