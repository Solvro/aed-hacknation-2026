import { DOCUMENT } from '@angular/common';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { CookieService } from 'ngx-cookie-service';
import { LocalStorageService } from 'ngx-localstorage';
import { Observable, of, shareReplay } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { ApiConfig } from '@app/services/api';
import { SearchHttpParamEncoder } from '@app/services/http/SearchHttpParamEncoder';
import { LoginService } from '@app/services/login-service';
import { NotificationsService } from '@app/services/notifications.service';
import { RestService } from '@app/services/rest.service';

export interface AedAggregateInfo {
  dataset_id: number;
  dataset_slug: string;
  owner: string;
  csv_resource_id: number;
  geojson_resource_id: number;
  records_count: number;
  providers_count: number;
  last_built: string;
}

export interface AedProvider {
  id: number;
  dostawca: string;
  regon: string;
  aktywne: number;
  wycofane: number;
  srednia_jakosc: number;
  ostatnia_aktualizacja: string | null;
  zbior_zrodlowy_id: number | null;
  zbior_zrodlowy_tytul: string;
  zasob_zrodlowy_id: number | null;
  zasob_zrodlowy_tytul: string;
}

export type AedRecord = Record<string, any>;

/**
 * Ogólnopolski zbiór AED – publiczne API tylko do odczytu (/aed/*).
 */
@Injectable({
  providedIn: 'root',
})
export class AedService extends RestService {
  private aggregate$: Observable<AedAggregateInfo | null>;

  constructor(
    protected http: HttpClient,
    public translate: TranslateService,
    public router: Router,
    public notificationService: NotificationsService,
    public storageService: LocalStorageService,
    public cookieService: CookieService,
    public loginService: LoginService,
    @Inject(DOCUMENT) public document: any,
    @Inject(PLATFORM_ID) public platformId: string,
  ) {
    super(http, translate, router, notificationService, storageService, cookieService, loginService, document, platformId);
  }

  /** Informacja o agregacie (null, jeżeli agregat nie istnieje) – cache na czas sesji. */
  getAggregate(): Observable<AedAggregateInfo | null> {
    if (!this.aggregate$) {
      this.aggregate$ = this.get(ApiConfig.aedAggregate, undefined, true).pipe(
        map((response: any) => response?.data?.attributes ?? null),
        catchError(() => of(null)),
        shareReplay(1),
      );
    }
    return this.aggregate$;
  }

  getProviders(): Observable<AedProvider[]> {
    return this.get(ApiConfig.aedProviders, undefined, true).pipe(
      map((response: any) => (response?.data ?? []).map((item: any) => ({ id: item.id, ...item.attributes }))),
    );
  }

  getProviderRecords(providerId: number, perPage = 500): Observable<AedRecord[]> {
    const params = new HttpParams({
      fromObject: { dostawca: String(providerId), per_page: String(perPage) },
      encoder: new SearchHttpParamEncoder(),
    });
    return this.get(ApiConfig.aedRecords, params, true).pipe(
      map((response: any) => (response?.data ?? []).map((item: any) => item.attributes)),
    );
  }
}
