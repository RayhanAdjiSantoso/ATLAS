import { asyncHandler } from '../utils/errors.js';
import * as metaAutomationService from '../services/metaAutomationService.js';

export const getAccounts = asyncHandler(async (req, res) => {
  const accounts = await metaAutomationService.callAppsScript('accounts');
  res.json({ accounts });
});

export const getLog = asyncHandler(async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const log = await metaAutomationService.callAppsScript('log', { limit });
  res.json({ log });
});

export const weeklyRun = asyncHandler(async (req, res) => {
  const result = await metaAutomationService.callAppsScript('weeklyRun');
  res.json({ result });
});

export const weeklyCheckTokens = asyncHandler(async (req, res) => {
  const tokens = await metaAutomationService.callAppsScript('weeklyCheckTokens');
  res.json({ tokens });
});

export const dailyRun = asyncHandler(async (req, res) => {
  const result = await metaAutomationService.callAppsScript('dailyRun');
  res.json({ result });
});

export const dailyResetCooldown = asyncHandler(async (req, res) => {
  const result = await metaAutomationService.callAppsScript('dailyResetCooldown');
  res.json({ result });
});

export const trackingList = asyncHandler(async (req, res) => {
  const configs = await metaAutomationService.callAppsScript('trackingList');
  res.json({ configs });
});

export const trackingCreate = asyncHandler(async (req, res) => {
  const savedConfig = await metaAutomationService.callAppsScript('trackingSave', req.body);
  res.status(201).json({ config: savedConfig });
});

export const trackingUpdate = asyncHandler(async (req, res) => {
  const savedConfig = await metaAutomationService.callAppsScript('trackingSave', { ...req.body, id: req.params.id });
  res.json({ config: savedConfig });
});

export const trackingDelete = asyncHandler(async (req, res) => {
  const configs = await metaAutomationService.callAppsScript('trackingDelete', { id: req.params.id });
  res.json({ configs });
});

export const trackingPreview = asyncHandler(async (req, res) => {
  const preview = await metaAutomationService.callAppsScript('trackingPreview', { id: req.params.id });
  res.json({ preview });
});

export const trackingRunAll = asyncHandler(async (req, res) => {
  const result = await metaAutomationService.callAppsScript('trackingRunAll');
  res.json({ result });
});

export const brandAccountList = asyncHandler(async (req, res) => {
  const accounts = await metaAutomationService.callAppsScript('accountList');
  res.json({ accounts });
});

export const brandAccountCreate = asyncHandler(async (req, res) => {
  const account = await metaAutomationService.callAppsScript('accountSave', req.body);
  res.status(201).json({ account });
});

export const brandAccountUpdate = asyncHandler(async (req, res) => {
  const account = await metaAutomationService.callAppsScript('accountSave', { ...req.body, id: req.params.id });
  res.json({ account });
});

export const brandAccountDelete = asyncHandler(async (req, res) => {
  const accounts = await metaAutomationService.callAppsScript('accountDelete', { id: req.params.id });
  res.json({ accounts });
});

export const brandAccountCampaigns = asyncHandler(async (req, res) => {
  const campaigns = await metaAutomationService.callAppsScript('accountCampaigns', { id: req.params.id });
  res.json({ campaigns });
});
