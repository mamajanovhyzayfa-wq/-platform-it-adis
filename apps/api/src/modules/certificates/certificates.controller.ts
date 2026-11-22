import { Body, Controller, Get, Header, Param, Post, Query, Res, StreamableFile } from '@nestjs/common'
import type { Response } from 'express'
import { z } from 'zod'
import { CurrentUser, Public, Roles, type AuthUser } from '../../nest/common/decorators.js'
import { badRequest } from '../../lib/errors.js'
import { CertificatesService } from './certificates.service.js'
import {
  certificateCandidatesSchema,
  certificateIssueSchema,
  certificateQuerySchema,
  certificateRevokeSchema,
  type CertificateIssueInput,
  type CertificateQuery,
} from './certificates.schemas.js'

/** Разбор входа: единый формат 400 с указанием полей. */
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw badRequest(
      'Проверьте правильность заполнения полей',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    )
  }
  return result.data
}

@Controller('api/certificates')
export class CertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Get()
  @Roles('ADMIN')
  list(@Query() query: unknown) {
    const input: CertificateQuery = parse(certificateQuerySchema, query)
    return this.certificates.list(input)
  }

  @Get('my')
  my(@CurrentUser() user: AuthUser) {
    return this.certificates.my(user.userId)
  }

  @Get('candidates')
  @Roles('ADMIN')
  candidates(@Query() query: unknown) {
    return this.certificates.candidates(parse(certificateCandidatesSchema, query))
  }

  @Get('verify/:code')
  @Public()
  verify(@Param('code') code: string) {
    return this.certificates.verify(code)
  }

  @Get(':id/file')
  async file(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Query('download') download: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.certificates.file(id, user)
    const disposition = download === '1' ? 'attachment' : 'inline'
    response.setHeader('Content-Type', file.mimeType)
    response.setHeader(
      'Content-Disposition',
      `${disposition}; filename="certificate"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    )
    response.setHeader('Content-Length', String(file.size))
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Cache-Control', 'private, no-store')
    return new StreamableFile(file.stream)
  }

  @Get(':id/html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  html(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.certificates.html(id, user)
  }

  @Post()
  @Roles('ADMIN')
  issue(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    const input: CertificateIssueInput = parse(certificateIssueSchema, body)
    return this.certificates.issue(input, user.userId)
  }

  @Post(':id/revoke')
  @Roles('ADMIN')
  revoke(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthUser) {
    const input = parse(certificateRevokeSchema, body)
    return this.certificates.revoke(id, input.reason, user.userId)
  }
}
