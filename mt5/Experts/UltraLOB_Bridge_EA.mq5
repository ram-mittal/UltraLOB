//+------------------------------------------------------------------+
//| UltraLOB Bridge EA - MT5 Demo Connector                          |
//| Phase 1: account heartbeat, risk-sized demo commands and acks.    |
//| LIVE ACCOUNTS ARE REJECTED BY DESIGN IN THIS BUILD.               |
//+------------------------------------------------------------------+
#property strict
#property version   "0.1.0"
#property description "UltraLOB MT5 demo-only connector. Live execution is disabled."

input string InpApiBaseUrl = "https://ultralob.onrender.com";
input string InpConnectorId = "";
input string InpAccessToken = "";
input string InpSymbols = "XAUUSD,BTCUSD";
input bool   InpEnableDemoExecution = false; // Must be explicitly enabled after demo pairing.
input double InpMaxTradeRiskPct = 0.50;       // Local maximum risk per trade (% of equity).
input double InpMaxSpreadPoints = 100.0;
input int    InpMaxDeviationPoints = 20;
input int    InpMaxOpenPositions = 2;
input int    InpTimerSeconds = 5;
input int    InpHttpTimeoutMs = 2500;
input ulong  InpMagicNumber = 26052601;

string g_baseUrl = "";
string g_activeCommandId = "";
ulong  g_activeOrderTicket = 0;
double g_expectedVolume = 0.0;
double g_filledVolume = 0.0;
bool   g_busy = false;

//+------------------------------------------------------------------+
//| Helpers                                                          |
//+------------------------------------------------------------------+
string JsonEscape(string value)
{
   StringReplace(value, "\\", "\\\\");
   StringReplace(value, "\"", "\\\"");
   StringReplace(value, "\r", "\\r");
   StringReplace(value, "\n", "\\n");
   StringReplace(value, "\t", "\\t");
   return value;
}

string AccountModeText()
{
   long mode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   if(mode == ACCOUNT_TRADE_MODE_DEMO) return "DEMO";
   if(mode == ACCOUNT_TRADE_MODE_REAL) return "REAL";
   if(mode == ACCOUNT_TRADE_MODE_CONTEST) return "CONTEST";
   return "UNKNOWN";
}

string BuildPositionsJson()
{
   string json = "[";
   bool first = true;
   int total = PositionsTotal();

   for(int i = 0; i < total; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;

      string symbol = PositionGetString(POSITION_SYMBOL);
      long type = PositionGetInteger(POSITION_TYPE);
      string side = (type == POSITION_TYPE_BUY ? "BUY" : "SELL");
      double volume = PositionGetDouble(POSITION_VOLUME);
      double price = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl = PositionGetDouble(POSITION_SL);
      double tp = PositionGetDouble(POSITION_TP);
      double profit = PositionGetDouble(POSITION_PROFIT);

      if(!first) json += ",";
      first = false;
      json += StringFormat(
         "{\"ticket\":\"%I64u\",\"symbol\":\"%s\",\"side\":\"%s\",\"volume\":%.8f,\"price_open\":%.10f,\"stop_loss\":%.10f,\"take_profit\":%.10f,\"profit\":%.2f}",
         ticket, JsonEscape(symbol), side, volume, price, sl, tp, profit
      );
   }

   json += "]";
   return json;
}

string BuildSymbolSpecsJson()
{
   string json = "[";
   string symbols[];
   int count = StringSplit(InpSymbols, StringGetCharacter(",", 0), symbols);
   bool first = true;

   for(int i = 0; i < count; i++)
   {
      string symbol = symbols[i];
      StringTrimLeft(symbol);
      StringTrimRight(symbol);
      if(symbol == "") continue;

      if(!SymbolSelect(symbol, true))
      {
         Print("UltraLOB: cannot select broker symbol ", symbol, " error=", GetLastError());
         continue;
      }

      double bid = SymbolInfoDouble(symbol, SYMBOL_BID);
      double ask = SymbolInfoDouble(symbol, SYMBOL_ASK);
      double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
      double tickSize = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
      double tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE);
      double volumeMin = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
      double volumeMax = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
      double volumeStep = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
      long stopsLevel = SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL);

      if(!first) json += ",";
      first = false;
      json += StringFormat(
         "{\"symbol\":\"%s\",\"bid\":%.10f,\"ask\":%.10f,\"point\":%.10f,\"tick_size\":%.10f,\"tick_value\":%.10f,\"volume_min\":%.8f,\"volume_max\":%.8f,\"volume_step\":%.8f,\"stops_level\":%I64d}",
         JsonEscape(symbol), bid, ask, point, tickSize, tickValue,
         volumeMin, volumeMax, volumeStep, stopsLevel
      );
   }

   json += "]";
   return json;
}

bool HttpRequest(const string method, const string path, const string body, string &responseBody, int &httpStatus)
{
   string url = g_baseUrl + path;
   string headers = "Authorization: Bearer " + InpAccessToken + "\r\n";
   headers += "Content-Type: application/json\r\n";
   headers += "Accept: application/json\r\n";

   char requestData[];
   if(body != "")
   {
      int copied = StringToCharArray(body, requestData, 0, WHOLE_ARRAY, CP_UTF8);
      if(copied > 0) ArrayResize(requestData, copied - 1); // remove terminal NUL
   }
   else
   {
      ArrayResize(requestData, 0);
   }

   char responseData[];
   string responseHeaders = "";
   ResetLastError();
   httpStatus = WebRequest(method, url, headers, InpHttpTimeoutMs,
                           requestData, responseData, responseHeaders);
   if(httpStatus == -1)
   {
      Print("UltraLOB WebRequest failed path=", path, " error=", GetLastError(),
            ". Add ", g_baseUrl, " to MT5 Tools > Options > Expert Advisors > Allow WebRequest.");
      responseBody = "";
      return false;
   }

   responseBody = CharArrayToString(responseData, 0, WHOLE_ARRAY, CP_UTF8);
   return (httpStatus >= 200 && httpStatus < 300);
}

string JsonGetString(const string json, const string key)
{
   string marker = "\"" + key + "\"";
   int keyPos = StringFind(json, marker);
   if(keyPos < 0) return "";
   int colon = StringFind(json, ":", keyPos + StringLen(marker));
   if(colon < 0) return "";
   int start = StringFind(json, "\"", colon + 1);
   if(start < 0) return "";
   int end = StringFind(json, "\"", start + 1);
   if(end < 0) return "";
   return StringSubstr(json, start + 1, end - start - 1);
}

double JsonGetNumber(const string json, const string key)
{
   string marker = "\"" + key + "\"";
   int keyPos = StringFind(json, marker);
   if(keyPos < 0) return 0.0;
   int colon = StringFind(json, ":", keyPos + StringLen(marker));
   if(colon < 0) return 0.0;
   int start = colon + 1;
   while(start < StringLen(json) && (StringGetCharacter(json, start) == ' ' || StringGetCharacter(json, start) == '\t'))
      start++;
   int end = start;
   while(end < StringLen(json))
   {
      ushort ch = StringGetCharacter(json, end);
      if(ch == ',' || ch == '}' || ch == ']' || ch == '\r' || ch == '\n') break;
      end++;
   }
   string value = StringSubstr(json, start, end - start);
   StringTrimLeft(value);
   StringTrimRight(value);
   return StringToDouble(value);
}

void SendAcknowledgement(const string commandId, const string status,
                         const string reason, const ulong orderTicket,
                         const ulong dealTicket, const uint retcode)
{
   if(commandId == "") return;
   string body = "{";
   body += "\"status\":\"" + status + "\"";
   body += ",\"broker_order_id\":\"" + (orderTicket > 0 ? StringFormat("%I64u", orderTicket) : "") + "\"";
   body += ",\"broker_deal_id\":\"" + (dealTicket > 0 ? StringFormat("%I64u", dealTicket) : "") + "\"";
   body += ",\"broker_retcode\":\"" + IntegerToString((int)retcode) + "\"";
   body += ",\"broker_comment\":\"" + JsonEscape(reason) + "\"";
   if(status == "REJECTED")
   {
      body += ",\"error_code\":\"MT5_LOCAL_REJECT\"";
      body += ",\"error_message\":\"" + JsonEscape(reason) + "\"";
   }
   body += "}";

   string response;
   int httpStatus = 0;
   string path = "/api/execution/connectors/" + InpConnectorId +
                 "/commands/" + commandId + "/ack";
   if(!HttpRequest("POST", path, body, response, httpStatus))
      Print("UltraLOB acknowledgement failed command=", commandId, " http=", httpStatus, " response=", response);
   else
      Print("UltraLOB acknowledgement recorded command=", commandId, " status=", status);
}

bool IsAllowedSymbol(const string symbol)
{
   string symbols[];
   int count = StringSplit(InpSymbols, StringGetCharacter(",", 0), symbols);
   for(int i = 0; i < count; i++)
   {
      StringTrimLeft(symbols[i]);
      StringTrimRight(symbols[i]);
      if(symbols[i] == symbol) return true;
   }
   return false;
}

void RejectCommand(const string commandId, const string reason)
{
   Print("UltraLOB command rejected locally: ", reason, " command=", commandId);
   SendAcknowledgement(commandId, "REJECTED", reason, 0, 0, 0);
}

bool IsSuccessfulRetcode(const uint retcode)
{
   return (retcode == TRADE_RETCODE_DONE ||
           retcode == TRADE_RETCODE_DONE_PARTIAL ||
           retcode == TRADE_RETCODE_PLACED);
}

//+------------------------------------------------------------------+
//| Account heartbeat                                                |
//+------------------------------------------------------------------+
bool SendHeartbeat()
{
   string body = "{";
   body += "\"login\":\"" + StringFormat("%I64d", AccountInfoInteger(ACCOUNT_LOGIN)) + "\"";
   body += ",\"server\":\"" + JsonEscape(AccountInfoString(ACCOUNT_SERVER)) + "\"";
   body += ",\"company\":\"" + JsonEscape(AccountInfoString(ACCOUNT_COMPANY)) + "\"";
   body += ",\"currency\":\"" + JsonEscape(AccountInfoString(ACCOUNT_CURRENCY)) + "\"";
   body += ",\"leverage\":" + IntegerToString((int)AccountInfoInteger(ACCOUNT_LEVERAGE));
   body += ",\"trade_mode\":\"" + AccountModeText() + "\"";
   body += ",\"terminal_connected\":" + (TerminalInfoInteger(TERMINAL_CONNECTED) ? "true" : "false");
   body += ",\"terminal_trade_allowed\":" + (TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) ? "true" : "false");
   body += ",\"ea_trade_allowed\":" + (MQLInfoInteger(MQL_TRADE_ALLOWED) ? "true" : "false");
   body += ",\"balance\":" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2);
   body += ",\"equity\":" + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2);
   body += ",\"margin\":" + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN), 2);
   body += ",\"margin_free\":" + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2);
   body += ",\"positions\":" + BuildPositionsJson();
   body += ",\"symbol_specs\":" + BuildSymbolSpecsJson();
   body += "}";

   string response;
   int status = 0;
   string path = "/api/execution/connectors/" + InpConnectorId + "/heartbeat";
   bool ok = HttpRequest("POST", path, body, response, status);
   if(!ok)
   {
      Print("UltraLOB heartbeat failed http=", status, " response=", response);
      return false;
   }
   return true;
}

//+------------------------------------------------------------------+
//| Local broker-side order checks and demo execution                |
//+------------------------------------------------------------------+
void ProcessCommand(const string json)
{
   string status = JsonGetString(json, "status");
   if(status != "command") return;

   string commandId = JsonGetString(json, "command_id");
   string symbol = JsonGetString(json, "symbol");
   string side = JsonGetString(json, "side");
   double volume = JsonGetNumber(json, "volume");
   double stopLoss = JsonGetNumber(json, "stop_loss");
   double takeProfit = JsonGetNumber(json, "take_profit");
   double serverRiskPct = JsonGetNumber(json, "risk_pct");
   double maxDeviation = JsonGetNumber(json, "max_deviation_points");

   if(commandId == "" || symbol == "" || volume <= 0)
   {
      RejectCommand(commandId, "Malformed command payload.");
      return;
   }

   string dedupeKey = "ULB_" + commandId;
   if(GlobalVariableCheck(dedupeKey))
   {
      Print("UltraLOB duplicate delivery ignored: ", commandId);
      SendAcknowledgement(commandId, "ACCEPTED", "Previously submitted; duplicate delivery ignored.",
                          0, 0, TRADE_RETCODE_DONE);
      return;
   }

   if(!InpEnableDemoExecution)
   {
      RejectCommand(commandId, "Demo execution switch is disabled in EA inputs.");
      return;
   }
   if(AccountInfoInteger(ACCOUNT_TRADE_MODE) != ACCOUNT_TRADE_MODE_DEMO)
   {
      RejectCommand(commandId, "Live or contest accounts are prohibited by this EA build.");
      return;
   }
   if(!TerminalInfoInteger(TERMINAL_CONNECTED) ||
      !TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) ||
      !MQLInfoInteger(MQL_TRADE_ALLOWED))
   {
      RejectCommand(commandId, "MT5 connection or automated-trading permission is unavailable.");
      return;
   }
   if(!IsAllowedSymbol(symbol))
   {
      RejectCommand(commandId, "Symbol is not in the EA allowlist.");
      return;
   }
   if(side != "BUY" && side != "SELL")
   {
      RejectCommand(commandId, "Unsupported order side.");
      return;
   }
   if(!SymbolSelect(symbol, true))
   {
      RejectCommand(commandId, "Broker symbol is not available: " + symbol);
      return;
   }

   MqlTick tick;
   if(!SymbolInfoTick(symbol, tick) || tick.bid <= 0 || tick.ask < tick.bid)
   {
      RejectCommand(commandId, "No valid broker quote is available.");
      return;
   }

   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   double tickSize = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
   double tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE);
   double volumeMin = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double volumeMax = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   double volumeStep = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   double spreadPoints = (tick.ask - tick.bid) / point;

   if(point <= 0 || tickSize <= 0 || tickValue <= 0 ||
      volumeStep <= 0 || volume < volumeMin || volume > volumeMax)
   {
      RejectCommand(commandId, "Broker tick, tick value or volume specification is invalid.");
      return;
   }
   double volumeUnits = volume / volumeStep;
   if(MathAbs(volumeUnits - MathRound(volumeUnits)) > 1e-6)
   {
      RejectCommand(commandId, "Server volume is not aligned to the broker's volume step.");
      return;
   }
   if(PositionsTotal() >= InpMaxOpenPositions)
   {
      RejectCommand(commandId, "Local maximum open-position count reached.");
      return;
   }
   if(spreadPoints > InpMaxSpreadPoints)
   {
      RejectCommand(commandId, "Live spread exceeds the EA's local maximum.");
      return;
   }
   if(serverRiskPct <= 0 || serverRiskPct > InpMaxTradeRiskPct)
   {
      RejectCommand(commandId, "Server risk percentage exceeds the EA's local risk cap.");
      return;
   }

   double price = (side == "BUY" ? tick.ask : tick.bid);
   stopLoss = NormalizeDouble(stopLoss, digits);
   takeProfit = NormalizeDouble(takeProfit, digits);

   if(side == "BUY" && !(stopLoss < price && takeProfit > price))
   {
      RejectCommand(commandId, "BUY protection prices are on the wrong side of the live quote.");
      return;
   }
   if(side == "SELL" && !(stopLoss > price && takeProfit < price))
   {
      RejectCommand(commandId, "SELL protection prices are on the wrong side of the live quote.");
      return;
   }
   long stopsLevel = SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL);
   if(MathAbs(price - stopLoss) + 1e-10 < (double)stopsLevel * point)
   {
      RejectCommand(commandId, "Stop-loss is inside the broker's current minimum stop distance.");
      return;
   }

   // Verify actual account-currency loss using the terminal's own contract rules.
   ENUM_ORDER_TYPE orderType = (side == "BUY" ? ORDER_TYPE_BUY : ORDER_TYPE_SELL);
   double expectedProfitAtStop = 0.0;
   if(!OrderCalcProfit(orderType, symbol, volume, price, stopLoss, expectedProfitAtStop))
   {
      RejectCommand(commandId, "OrderCalcProfit failed; cannot validate account-currency risk.");
      return;
   }
   double actualRisk = MathAbs(MathMin(0.0, expectedProfitAtStop));
   double localRiskCap = AccountInfoDouble(ACCOUNT_EQUITY) * InpMaxTradeRiskPct / 100.0;
   if(actualRisk <= 0 || actualRisk > localRiskCap + 0.01)
   {
      RejectCommand(commandId, "Broker-calculated loss at stop exceeds the local account risk cap.");
      return;
   }

   MqlTradeRequest request = {};
   MqlTradeCheckResult check = {};
   MqlTradeResult result = {};
   request.action = TRADE_ACTION_DEAL;
   request.magic = InpMagicNumber;
   request.symbol = symbol;
   request.volume = volume;
   request.type = orderType;
   request.price = price;
   request.sl = stopLoss;
   request.tp = takeProfit;
   request.deviation = (ulong)MathMax(0, MathMin(InpMaxDeviationPoints, (int)maxDeviation));
   request.type_time = ORDER_TIME_GTC;
   request.comment = "UltraLOB " + StringSubstr(commandId, 0, 12);

   long filling = SymbolInfoInteger(symbol, SYMBOL_FILLING_MODE);
   if((filling & SYMBOL_FILLING_FOK) != 0)
      request.type_filling = ORDER_FILLING_FOK;
   else if((filling & SYMBOL_FILLING_IOC) != 0)
      request.type_filling = ORDER_FILLING_IOC;
   else
      request.type_filling = ORDER_FILLING_RETURN;

   ResetLastError();
   bool checkPassed = OrderCheck(request, check);
   // A true return means the request structure passed basic validation;
   // inspect the trade-server retcode as well before submitting.
   if(!checkPassed || check.retcode != 0)
   {
      string checkReason = "OrderCheck rejected request: retcode=" +
                           IntegerToString((int)check.retcode) + " comment=" + check.comment;
      RejectCommand(commandId, checkReason);
      return;
   }

   ResetLastError();
   bool sent = OrderSend(request, result);
   if(!sent || !IsSuccessfulRetcode(result.retcode))
   {
      string reason = "OrderSend failed. retcode=" + IntegerToString((int)result.retcode) +
                      " comment=" + result.comment;
      RejectCommand(commandId, reason);
      return;
   }

   // Persist the command ID locally before acknowledging; a lost HTTP ack cannot
   // make a redelivered command submit a duplicate order.
   GlobalVariableSet(dedupeKey, 1.0);
   g_activeCommandId = commandId;
   g_activeOrderTicket = result.order;
   g_expectedVolume = volume;
   g_filledVolume = 0.0;

   SendAcknowledgement(commandId, "ACCEPTED", result.comment,
                       result.order, result.deal, result.retcode);
   PrintFormat("UltraLOB demo order accepted: %s %s %.2f lots at %.5f, stop %.5f, target %.5f",
               side, symbol, volume, price, stopLoss, takeProfit);
}

//+------------------------------------------------------------------+
//| Polling                                                          |
//+------------------------------------------------------------------+
void PollNextCommand()
{
   if(!InpEnableDemoExecution || g_activeCommandId != "") return;

   string response;
   int status = 0;
   string path = "/api/execution/connectors/" + InpConnectorId + "/next";
   if(!HttpRequest("GET", path, "", response, status))
   {
      if(status != 200 && status != 409)
         Print("UltraLOB command poll failed http=", status, " response=", response);
      return;
   }

   string commandStatus = JsonGetString(response, "status");
   if(commandStatus == "command")
      ProcessCommand(response);
   else if(commandStatus == "paused")
      Print("UltraLOB execution paused: ", JsonGetString(response, "message"));
}

//+------------------------------------------------------------------+
//| Expert lifecycle                                                  |
//+------------------------------------------------------------------+
int OnInit()
{
   g_baseUrl = InpApiBaseUrl;
   while(StringLen(g_baseUrl) > 0 && StringSubstr(g_baseUrl, StringLen(g_baseUrl) - 1) == "/")
      g_baseUrl = StringSubstr(g_baseUrl, 0, StringLen(g_baseUrl) - 1);

   if(StringFind(g_baseUrl, "https://") != 0)
   {
      Print("UltraLOB: HTTPS API base URL is required.");
      return INIT_PARAMETERS_INCORRECT;
   }
   if(InpConnectorId == "" || InpAccessToken == "")
   {
      Print("UltraLOB: enter the connector ID and one-time access token from the UltraLOB admin pairing response.");
      return INIT_PARAMETERS_INCORRECT;
   }
   if(AccountInfoInteger(ACCOUNT_TRADE_MODE) != ACCOUNT_TRADE_MODE_DEMO)
   {
      Print("UltraLOB: this connector is DEMO ONLY. Attach it to an MT5 demo account.");
      return INIT_FAILED;
   }
   if(InpTimerSeconds < 3 || InpTimerSeconds > 30)
   {
      Print("UltraLOB: timer interval must be between 3 and 30 seconds.");
      return INIT_PARAMETERS_INCORRECT;
   }

   if(!EventSetTimer(InpTimerSeconds))
   {
      Print("UltraLOB: could not start timer. error=", GetLastError());
      return INIT_FAILED;
   }

   Print("UltraLOB MT5 Bridge initialized in DEMO mode. Execution switch=",
         (InpEnableDemoExecution ? "ON" : "OFF"),
         ". Add ", g_baseUrl, " to MT5 WebRequest allowed URLs.");
   SendHeartbeat();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Print("UltraLOB MT5 Bridge stopped. reason=", reason);
}

void OnTimer()
{
   if(g_busy) return;
   g_busy = true;
   SendHeartbeat();
   PollNextCommand();
   g_busy = false;
}

void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
{
   if(g_activeCommandId == "" || g_activeOrderTicket == 0) return;
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD || trans.order != g_activeOrderTicket) return;

   g_filledVolume += trans.volume;
   string fillStatus = (g_filledVolume + 1e-8 >= g_expectedVolume ? "FILLED" : "PARTIAL");
   SendAcknowledgement(g_activeCommandId, fillStatus,
                       "MT5 deal transaction received.",
                       trans.order, trans.deal, result.retcode);

   if(fillStatus == "FILLED")
   {
      g_activeCommandId = "";
      g_activeOrderTicket = 0;
      g_expectedVolume = 0.0;
      g_filledVolume = 0.0;
   }
}
